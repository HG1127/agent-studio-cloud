import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { FatalError } from "workflow";
import { db } from "@/lib/db";
import { defaultResultDeliveries, runs } from "@/db/schema";
import { DefaultResultCompletionSource, DefaultResultDeliveryRecord, type DefaultResultDeliveryOperation, type DefaultResultDeliveryStepResult } from "@/contracts/default-result-delivery";
import {
  canClaimDefaultResultOperation, defaultResultDeliveryHookToken, defaultResultDeliveryOwner,
  requiresDefaultResultDelivery, settledDefaultResultOperation,
} from "@/server/domain/runtime/default-result-delivery";
import { classifyDefaultResultFrame, decideDefaultResultStream } from "@/server/domain/runtime/default-result-stream";
import {
  closeDefaultResultStream, DefaultResultStreamSdkError, observeDefaultResultStream, writeDefaultResultStreamFrame,
} from "@/server/services/default-result-stream-sdk";
import { withSafeWorkflowError } from "@/server/security/workflow-error";

type DeliveryRow = typeof defaultResultDeliveries.$inferSelect;

export function readDefaultResultDeliveryRecord(row: DeliveryRow): DefaultResultDeliveryRecord {
  try {
    const parsed = DefaultResultDeliveryRecord.parse({
      runId: row.runId, workspaceId: row.workspaceId, createdBy: row.createdBy, sdkRunId: row.sdkRunId, frozen: row.frozen,
      status: row.status, writeAttempts: row.writeAttempts, operation: row.operation, operationToken: row.operationToken, waitingHookToken: row.waitingHookToken,
      waitingHookStepId: row.waitingHookStepId,
      acknowledgement: row.acknowledgement, producerSettled: row.producerSettled, error: row.error,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), confirmedAt: row.confirmedAt?.toISOString() ?? null,
    });
    defaultResultDeliveryOwner(parsed);
    return parsed;
  } catch { throw new FatalError("成果投递记录无效，不能继续发送"); }
}

export async function readDefaultResultDelivery(runId: string, workspaceId: string): Promise<DefaultResultDeliveryRecord | null> {
  const [run] = await withSafeWorkflowError(
    () => db.select().from(runs).where(and(eq(runs.id, runId), eq(runs.workspaceId, workspaceId))).limit(1),
    "运行成果暂时无法读取，请稍后重试",
  );
  if (!run) return null;
  const source = DefaultResultCompletionSource.safeParse({
    runId: run.id, workspaceId: run.workspaceId, createdBy: run.createdBy,
    parentRunId: run.parentRunId, sourceType: run.sourceType, sdkRunId: run.workflowRunId, trackingVersion: run.defaultResultTrackingVersion,
  });
  if (!source.success) throw new FatalError("运行成果归属信息无效");
  if (run.status !== "completed" || !requiresDefaultResultDelivery(source.data)) return null;
  const [row] = await withSafeWorkflowError(() => db.select().from(defaultResultDeliveries)
    .where(and(eq(defaultResultDeliveries.runId, run.id), eq(defaultResultDeliveries.workspaceId, run.workspaceId))).limit(1),
  "成果投递记录暂时无法读取，请稍后重试");
  if (!row || row.sdkRunId !== run.workflowRunId || row.createdBy !== run.createdBy) throw new FatalError("成果投递与执行身份不一致，不能继续发送");
  const record = readDefaultResultDeliveryRecord(row);
  if (!run.finishedAt || record.frozen.frame.finishedAt !== run.finishedAt.toISOString()
    || classifyDefaultResultFrame(record.frozen, { ...record.frozen.frame, result: run.result }) !== "match") {
    throw new FatalError("已保存成果与冻结投递记录不一致，不能发送");
  }
  return record;
}

function scope(record: DefaultResultDeliveryRecord) {
  return and(eq(defaultResultDeliveries.runId, record.runId), eq(defaultResultDeliveries.workspaceId, record.workspaceId));
}

function sameIntent(current: DefaultResultDeliveryRecord, expected: DefaultResultDeliveryRecord): boolean {
  return current.sdkRunId === expected.sdkRunId && current.frozen.frameHash === expected.frozen.frameHash
    && current.status === expected.status && current.operationToken === expected.operationToken
    && current.writeAttempts === expected.writeAttempts && current.producerSettled === expected.producerSettled
    && current.acknowledgement === expected.acknowledgement;
}

export async function prepareDefaultResultDeliveryWait(runId: string, workspaceId: string, waitingStepId: string): Promise<DefaultResultDeliveryStepResult> {
  if (!waitingStepId || waitingStepId.length > 200) throw new FatalError("成果等待步骤身份无效");
  const record = await readDefaultResultDelivery(runId, workspaceId);
  if (!record) throw new FatalError("主流程冻结成果不存在");
  if (record.status === "confirmed" || record.status === "failed") return { status: record.status, hookToken: defaultResultDeliveryHookToken(record) };
  return withSafeWorkflowError(() => db.transaction(async (tx) => {
    const [row] = await tx.select().from(defaultResultDeliveries).where(scope(record)).for("update").limit(1);
    if (!row) throw new FatalError("主流程冻结成果不存在");
    const current = readDefaultResultDeliveryRecord(row);
    if (current.status === "confirmed" || current.status === "failed") return { status: current.status, hookToken: defaultResultDeliveryHookToken(current) };
    if (current.waitingHookStepId === waitingStepId && current.waitingHookToken) return { status: current.status, hookToken: current.waitingHookToken };
    const token = "default-result:" + current.runId + ":" + randomUUID();
    await tx.update(defaultResultDeliveries).set({ waitingHookToken: token, waitingHookStepId: waitingStepId, updatedAt: new Date() }).where(scope(current));
    return { status: current.status, hookToken: token };
  }), "成果核对等待入口暂时无法保存，请稍后重试");
}

async function claimOperation(record: DefaultResultDeliveryRecord, operation: DefaultResultDeliveryOperation): Promise<DefaultResultDeliveryRecord | null> {
  return withSafeWorkflowError(() => db.transaction(async (tx) => {
    const [row] = await tx.select().from(defaultResultDeliveries).where(scope(record)).for("update").limit(1);
    if (!row) throw new FatalError("成果投递记录不存在");
    const current = readDefaultResultDeliveryRecord(row);
    if (!sameIntent(current, record) || !canClaimDefaultResultOperation(current, operation)) return null;
    const token = randomUUID();
    // A sending intent is never reclaimed by elapsed time: the previous producer may still be alive.
    const [claimed] = await tx.update(defaultResultDeliveries).set({
      status: "sending", producerSettled: false, operation, operationToken: token, acknowledgement: "unknown", error: null,
      writeAttempts: current.writeAttempts + Number(operation === "write"), updatedAt: new Date(),
    }).where(scope(record)).returning();
    return claimed ? readDefaultResultDeliveryRecord(claimed) : null;
  }), "成果发送凭据暂时无法确认，请稍后重试");
}

async function finishOperation(
  claimed: DefaultResultDeliveryRecord,
  values: ReturnType<typeof settledDefaultResultOperation>,
): Promise<DefaultResultDeliveryRecord> {
  const [row] = await withSafeWorkflowError(() => db.update(defaultResultDeliveries).set({
    ...values, confirmedAt: values.status === "confirmed" ? new Date() : null, updatedAt: new Date(),
  }).where(and(scope(claimed), eq(defaultResultDeliveries.status, "sending"), eq(defaultResultDeliveries.operationToken, claimed.operationToken!)))
    .returning(), "成果发送结果暂时无法保存，请稍后核对");
  if (!row) throw new FatalError("成果发送凭据已发生变化，不能登记确认");
  return readDefaultResultDeliveryRecord(row);
}

async function recordVerifiedTerminal(record: DefaultResultDeliveryRecord, status: "confirmed" | "failed", error: string | null) {
  if (!record.producerSettled) return record;
  return withSafeWorkflowError(() => db.transaction(async (tx) => {
    const [row] = await tx.select().from(defaultResultDeliveries).where(scope(record)).for("update").limit(1);
    if (!row) throw new FatalError("成果投递记录不存在");
    const current = readDefaultResultDeliveryRecord(row);
    if (!sameIntent(current, record) || !current.producerSettled) return current;
    const [saved] = await tx.update(defaultResultDeliveries)
      .set({ status, error, acknowledgement: status === "confirmed" ? "confirmed" : current.acknowledgement, confirmedAt: status === "confirmed" ? new Date() : null, updatedAt: new Date() })
      .where(scope(record)).returning();
    if (!saved) throw new FatalError("成果核对结果保存失败");
    return readDefaultResultDeliveryRecord(saved);
  }), "成果核对结果暂时无法保存，请稍后重试");
}

async function recordObservationPending(record: DefaultResultDeliveryRecord): Promise<DefaultResultDeliveryRecord> {
  return withSafeWorkflowError(() => db.transaction(async (tx) => {
    const [row] = await tx.select().from(defaultResultDeliveries).where(scope(record)).for("update").limit(1);
    if (!row) throw new FatalError("成果投递记录不存在");
    const current = readDefaultResultDeliveryRecord(row);
    if (!sameIntent(current, record) || current.status === "confirmed" || current.status === "failed") return current;
    const [saved] = await tx.update(defaultResultDeliveries).set({
      // A companion read cannot revoke the active sender's same-token finish eligibility.
      status: current.status === "sending" ? "sending" : "waiting_review",
      error: "成果流暂时无法完整核对，原流程等待恢复消息", updatedAt: new Date(),
    }).where(scope(current)).returning();
    if (!saved) throw new FatalError("成果待核对状态保存失败");
    return readDefaultResultDeliveryRecord(saved);
  }), "成果待核对状态暂时无法保存，请稍后重试");
}

export async function deliverDefaultResult(runId: string, workspaceId: string, verifyOnly = false): Promise<DefaultResultDeliveryStepResult> {
  let record = await readDefaultResultDelivery(runId, workspaceId);
  if (!record) throw new FatalError("本次运行没有可发送的主流程成果");
  const hookToken = defaultResultDeliveryHookToken(record);
  for (let operations = 0; operations < 2; operations += 1) {
    if (record.status === "confirmed" || record.status === "failed") return { status: record.status, hookToken };
    const owner = defaultResultDeliveryOwner(record);
    let observed: Awaited<ReturnType<typeof observeDefaultResultStream>>;
    try { observed = await observeDefaultResultStream({ owner, frozen: record.frozen, producerSettled: record.producerSettled }); }
    catch (error) {
      if (!(error instanceof DefaultResultStreamSdkError) || error.code !== "observation-failed" || error.acknowledgement !== "none") throw error;
      // This safe read failure is durable pending work, not a step retry that may exhaust the root.
      record = await recordObservationPending(record);
      return { status: record.status, hookToken };
    }
    const decision = decideDefaultResultStream({ owner, observation: observed, sendAttempts: record.writeAttempts });
    if (decision.kind === "confirmed" || decision.kind === "failed") {
      record = await recordVerifiedTerminal(record, decision.kind, decision.kind === "failed" ? decision.reason : null);
      return { status: record.status, hookToken };
    }
    if (decision.kind === "wait" || decision.kind === "verify" || verifyOnly) return { status: record.status, hookToken };
    const operation = decision.kind;
    const claimed = await claimOperation(record, operation);
    if (!claimed) {
      const latest = await readDefaultResultDelivery(runId, workspaceId);
      return { status: latest?.status ?? "waiting_review", hookToken };
    }
    try {
      const updatedObservation = await (operation === "write" ? writeDefaultResultStreamFrame : closeDefaultResultStream)({
        owner, frozen: claimed.frozen, producerSettled: true, sendAttempts: record.writeAttempts,
      });
      const next = decideDefaultResultStream({ owner, observation: updatedObservation, sendAttempts: claimed.writeAttempts });
      record = await finishOperation(claimed, settledDefaultResultOperation({
        record: claimed, operation, acknowledgement: "confirmed", confirmed: next.kind === "confirmed", error: null,
      }));
      if (next.kind !== "close") return { status: record.status, hookToken };
    } catch (error) {
      // A lost database ACK after the wire operation leaves sending in place; no retry may append again.
      if (!(error instanceof DefaultResultStreamSdkError)) throw error;
      const acknowledgement = error.acknowledgement;
      record = await finishOperation(claimed, settledDefaultResultOperation({
        record: claimed, operation, acknowledgement, confirmed: false,
        error: acknowledgement === "unknown" ? "发送回执尚未确认，不能自动重发" : acknowledgement === "confirmed" ? "发送已获回执，成果仍需读回核对" : "发送尚未开始，稍后可重新核对",
      }));
      return { status: record.status, hookToken };
    }
  }
  return { status: record.status, hookToken };
}
