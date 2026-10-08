import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { start } from "workflow/api";
import { RunDeliveryEnvelope, RunDeliveryReceipt, RUN_DELIVERY_LEASE_MS } from "@/contracts/run-delivery";
import { RunTaskResultView } from "@/contracts/run-task";
import { agentVersions, runDeliveries, runs } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { deliveryAttemptIssue, deliveryEnvelopeMatches, deliveryRetryDelay } from "@/server/domain/runtime/run-delivery";
import { presentRunTaskResult } from "@/server/domain/runtime/run-task";
import { deliveryTargetBinding, getDeliveryTarget } from "@/server/delivery/target-registry";
import { invokeRunDelivery } from "@/server/delivery/invoke-delivery";
import { redactCredentialText } from "@/server/domain/security/redact-sensitive";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { deliverRunWorkflow } from "@/server/workflows/run-delivery";

export const MAX_DELIVERIES_PER_TICK = 10;
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

export async function dispatchPendingDeliveriesCore(workspaceId = DEMO_WORKSPACE_ID): Promise<{ materialized: number; claimed: number }> {
  const now = new Date();
  const waiting = await db.select({ id: runDeliveries.id }).from(runDeliveries).innerJoin(runs, and(eq(runs.id, runDeliveries.runId), eq(runs.workspaceId, runDeliveries.workspaceId)))
    .where(and(eq(runDeliveries.workspaceId, workspaceId), eq(runDeliveries.status, "waiting_result"), isNull(runDeliveries.archivedAt),
      inArray(runs.status, ["completed", "failed", "cancelled"])))
    .orderBy(asc(runDeliveries.createdAt), asc(runDeliveries.id)).limit(MAX_DELIVERIES_PER_TICK);
  let materialized = 0;
  for (const row of waiting) if (await materializeRunDelivery(row.id, workspaceId, now)) materialized++;
  const claimed = await db.transaction(async (tx) => {
    const due = await tx.select().from(runDeliveries).where(and(eq(runDeliveries.workspaceId, workspaceId), isNull(runDeliveries.archivedAt),
      lte(runDeliveries.nextAttemptAt, now), or(eq(runDeliveries.status, "pending"), and(inArray(runDeliveries.status, ["queued", "sending"]), lte(runDeliveries.leaseExpiresAt, now)))))
      .orderBy(asc(runDeliveries.nextAttemptAt), asc(runDeliveries.id)).limit(MAX_DELIVERIES_PER_TICK).for("update", { skipLocked: true });
    const jobs: { id: string; token: string }[] = [];
    for (const row of due) {
      const issue = deliveryAttemptIssue(row, now);
      if (issue) {
        await tx.update(runDeliveries).set({ status: "failed", error: issue, leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: null, updatedAt: now }).where(eq(runDeliveries.id, row.id));
        continue;
      }
      const token = randomUUID();
      await tx.update(runDeliveries).set({ status: "queued", leaseOwner: token, leaseExpiresAt: new Date(now.getTime() + RUN_DELIVERY_LEASE_MS),
        workflowRunId: null, updatedAt: now }).where(eq(runDeliveries.id, row.id));
      jobs.push({ id: row.id, token });
    }
    return jobs;
  });
  for (const job of claimed) {
    try {
      const workflow = await start(deliverRunWorkflow, [job.id, workspaceId, job.token]);
      await db.update(runDeliveries).set({ workflowRunId: workflow.runId, updatedAt: new Date() }).where(and(
        eq(runDeliveries.id, job.id), eq(runDeliveries.workspaceId, workspaceId), eq(runDeliveries.leaseOwner, job.token), isNull(runDeliveries.archivedAt)));
    } catch (error) {
      // 启动响应可能丢失；保留租约，旧工作流与过期接管通过同一标识安全竞争。
      console.error("投递启动结果待确认", safeErrorForLog(error));
    }
  }
  return { materialized, claimed: claimed.length };
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
