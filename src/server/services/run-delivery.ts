import { and, eq, isNull, sql } from "drizzle-orm";
import { RunDeliveryEnvelope, RunDeliveryReceipt, RUN_DELIVERY_LEASE_MS } from "@/contracts/run-delivery";
import { RunTaskResultView } from "@/contracts/run-task";
import { agentVersions, runDeliveries, runs } from "@/db/schema";
import { db } from "@/lib/db";
import { deliveryAttemptIssue, deliveryEnvelopeMatches, deliveryRetryDelay } from "@/server/domain/runtime/run-delivery";
import { presentRunTaskResult } from "@/server/domain/runtime/run-task";
import { deliveryTargetBinding, getDeliveryTarget } from "@/server/delivery/target-registry";
import { invokeRunDelivery } from "@/server/delivery/invoke-delivery";
import { redactCredentialText } from "@/server/domain/security/redact-sensitive";

export async function materializeRunDelivery(id: string, workspaceId: string, now = new Date()): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [delivery] = await tx.select().from(runDeliveries).where(and(eq(runDeliveries.id, id), eq(runDeliveries.workspaceId, workspaceId),
      eq(runDeliveries.status, "waiting_result"), isNull(runDeliveries.archivedAt))).for("update").limit(1);
    if (!delivery) return false;
    const [run] = await tx.select({ runId: runs.id, status: runs.status, error: runs.error,
      result: sql<unknown>`CASE WHEN ${runs.status} = 'completed' THEN ${runs.result} ELSE NULL END`,
      outputContract: sql<unknown>`${agentVersions.manifest} -> 'outputContract'`,
    }).from(runs).leftJoin(agentVersions, and(eq(agentVersions.id, runs.versionId), eq(agentVersions.workspaceId, runs.workspaceId), eq(agentVersions.agentId, runs.agentId)))
      .where(and(eq(runs.id, delivery.runId), eq(runs.workspaceId, workspaceId))).limit(1);
    if (!run || !["completed", "failed", "cancelled"].includes(run.status)) return false;
    let payload: RunDeliveryEnvelope;
    try {
      const task = presentRunTaskResult({ runId: run.runId, status: RunTaskResultView.shape.status.parse(run.status), error: run.error,
        result: RunTaskResultView.shape.result.parse(run.result), outputContract: RunTaskResultView.shape.outputContract.parse(run.outputContract ?? { fields: [] }) });
      payload = RunDeliveryEnvelope.parse({ schemaVersion: 1, deliveryId: delivery.id, task });
    } catch {
      await tx.update(runDeliveries).set({ status: "failed", error: "最终成果不符合投递契约，请核对任务记录", updatedAt: now })
        .where(eq(runDeliveries.id, delivery.id));
      return false;
    }
    await tx.update(runDeliveries).set({ status: "pending", payload, nextAttemptAt: now, updatedAt: now }).where(eq(runDeliveries.id, delivery.id));
    return true;
  });
}

export async function attemptRunDeliveryCore(id: string, workspaceId: string, token: string, fetchImpl?: typeof fetch) {
  const now = new Date();
  const prepared = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(runDeliveries).where(and(eq(runDeliveries.id, id), eq(runDeliveries.workspaceId, workspaceId), isNull(runDeliveries.archivedAt)))
      .for("update").limit(1);
    if (!row || row.leaseOwner !== token || ["delivered", "failed", "waiting_result", "pending"].includes(row.status)) return { kind: "stale" as const };
    if (row.status === "sending" || (row.nextAttemptAt && row.nextAttemptAt > now)) {
      return { kind: "retry" as const, after: Math.max(1000, (row.status === "sending" ? row.leaseExpiresAt : row.nextAttemptAt)!.getTime() - now.getTime()), error: "原投递仍在处理或等待重试" };
    }
    const payload = RunDeliveryEnvelope.safeParse(row.payload);
    const target = getDeliveryTarget(row.targetId);
    const issue = deliveryAttemptIssue(row, now)
      ?? (!target || deliveryTargetBinding(target).targetHash !== row.targetHash ? "投递接收方配置已移除或变化，请人工核对" : null)
      ?? (!payload.success || !deliveryEnvelopeMatches(payload.data, row.id, row.runId) ? "投递快照不完整，不能发送" : null);
    if (issue || !target || !payload.success) {
      await tx.update(runDeliveries).set({ status: "failed", error: issue ?? "投递配置不完整", leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: null, updatedAt: now }).where(eq(runDeliveries.id, row.id));
      return { kind: "fatal" as const, error: issue ?? "投递配置不完整" };
    }
    const deadline = row.retryDeadline ?? new Date(now.getTime() + row.retentionMs);
    await tx.update(runDeliveries).set({ status: "sending", attempts: row.attempts + 1, retryDeadline: deadline,
      leaseExpiresAt: new Date(now.getTime() + RUN_DELIVERY_LEASE_MS), updatedAt: now }).where(eq(runDeliveries.id, row.id));
    return { kind: "send" as const, target, payload: payload.data, attempt: row.attempts + 1, maxAttempts: row.maxAttempts, deadline };
  });
  if (prepared.kind !== "send") return prepared;
  const invocation = await invokeRunDelivery({ target: prepared.target, envelope: prepared.payload, fetchImpl });
  const finished = new Date();
  const after = deliveryRetryDelay(prepared.attempt);
  const retry = !invocation.ok && invocation.retryable && prepared.attempt < prepared.maxAttempts && finished.getTime() + after < prepared.deadline.getTime();
  const receipt = invocation.ok ? RunDeliveryReceipt.parse({ ...invocation.receipt,
    ...(invocation.receipt.receiptId ? { receiptId: redactCredentialText(invocation.receipt.receiptId).slice(0, 200) } : {}) }) : null;
  const error = invocation.ok ? null : invocation.error;
  const changed = await db.update(runDeliveries).set({
    status: invocation.ok ? "delivered" : retry ? "queued" : "failed", receipt, error,
    deliveredAt: invocation.ok ? finished : null, nextAttemptAt: retry ? new Date(finished.getTime() + after) : null,
    leaseOwner: retry ? token : null, leaseExpiresAt: retry ? new Date(finished.getTime() + after + RUN_DELIVERY_LEASE_MS) : null,
    updatedAt: finished,
  }).where(and(eq(runDeliveries.id, id), eq(runDeliveries.workspaceId, workspaceId), eq(runDeliveries.leaseOwner, token), eq(runDeliveries.status, "sending"), isNull(runDeliveries.archivedAt)))
    .returning({ id: runDeliveries.id });
  if (!changed.length) return { kind: "stale" as const };
  return invocation.ok ? { kind: "delivered" as const } : retry ? { kind: "retry" as const, after, error: error! } : { kind: "fatal" as const, error: error! };
}
