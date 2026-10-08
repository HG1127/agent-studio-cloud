"use server";
import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { AttentionHandlingEntry, AttentionHandlingHistory, AttentionHandlingInput, AttentionHandlingResult, AttentionHandlingSummary, MAX_ATTENTION_HANDLING_ENTRIES, type AttentionHandlingResult as Result } from "@/contracts/attention-handling";
import { attentionCases, runDeliveries, toolOperations } from "@/db/schema";
import { ToolOperationReceipt } from "@/contracts/tool-operation";
import { RunDeliveryReceipt } from "@/contracts/run-delivery";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { canonicalJson } from "@/server/domain/canonical-json";
import { attentionHandlingTransition, attentionSourceState } from "@/server/domain/attention-handling";
import { redactAttentionText } from "@/server/domain/attention";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { findCurrentAttention } from "@/server/queries/attention";
import { presentAttentionCase } from "@/server/queries/attention-cases";

class HandlingConflict extends Error {}
export async function recordAttentionHandlingAction(raw: AttentionHandlingInput): Promise<Result> {
  const parsed = AttentionHandlingInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "处理信息不完整或未明确确认" };
  const cleaned = AttentionHandlingInput.safeParse({ ...parsed.data, reason: redactAttentionText(parsed.data.reason) });
  if (!cleaned.success) return { ok: false, error: "处理原因脱敏后超过容量，请精简后重新提交" };
  const input = cleaned.data; const reference = input.reference;
  const requestHash = createHash("sha256").update(canonicalJson(input)).digest("hex");
  try {
    return await db.transaction(async (tx) => {
      const match = and(eq(attentionCases.workspaceId, DEMO_WORKSPACE_ID), eq(attentionCases.kind, reference.kind), eq(attentionCases.sourceId, reference.id), eq(attentionCases.occurrence, reference.occurrence), isNull(attentionCases.archivedAt));
      let [row] = await tx.select().from(attentionCases).where(match).for("update").limit(1);
      if (!row) {
        const current = await findCurrentAttention(DEMO_WORKSPACE_ID, reference, tx);
        if (!current || current.occurrence !== reference.occurrence) throw new HandlingConflict("事项不存在、已结束或已发生变化，请刷新待处理清单");
        await tx.insert(attentionCases).values({ workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, kind: reference.kind, sourceId: reference.id,
          runId: reference.runId, occurrence: reference.occurrence, title: current.title }).onConflictDoNothing();
        [row] = await tx.select().from(attentionCases).where(match).for("update").limit(1);
      }
      if (!row || row.runId !== reference.runId) throw new HandlingConflict("处理记录与原任务不一致");
      const history = AttentionHandlingHistory.parse(row.entries);
      AttentionHandlingSummary.parse({ caseId: row.id, status: row.status, revision: row.revision, entryCount: history.length, updatedAt: row.updatedAt.toISOString(), closedAt: row.closedAt?.toISOString() ?? null });
      const previous = history.find((entry) => entry.requestId === input.requestId);
      if (previous) {
        if (previous.requestHash !== requestHash) throw new HandlingConflict("同一次处理请求不能更换内容或版本");
        return AttentionHandlingResult.parse({ ok: true, recorded: true, item: await presentAttentionCase(row, tx) });
      }
      if (row.revision !== input.expectedRevision) throw new HandlingConflict("处理记录已被更新，请刷新后再提交");
      const current = await findCurrentAttention(DEMO_WORKSPACE_ID, reference, tx);
      const sourceState = attentionSourceState(reference, current?.occurrence ? { kind: current.kind, id: current.id, runId: current.runId, occurrence: current.occurrence } : null);
      const unresolved = input.action === "accept-failure" ? await tx.select({ id: toolOperations.id }).from(toolOperations).where(and(
        eq(toolOperations.workspaceId, DEMO_WORKSPACE_ID), eq(toolOperations.sourceRunId, reference.runId), inArray(toolOperations.status, ["pending", "blocked"]),
      )).limit(1) : [];
      let originalResolved = true;
      if (input.action === "close-resolved" && sourceState === "inactive" && reference.kind === "tool-operation") {
        const [operation] = await tx.select({ status: toolOperations.status, receipt: toolOperations.receipt }).from(toolOperations).where(and(eq(toolOperations.id, reference.id), eq(toolOperations.sourceRunId, reference.runId), eq(toolOperations.workspaceId, DEMO_WORKSPACE_ID))).limit(1);
        originalResolved = operation?.status === "completed" && ToolOperationReceipt.safeParse(operation.receipt).success;
      }
      if (input.action === "close-resolved" && sourceState === "inactive" && reference.kind === "delivery-failed") {
        const [delivery] = await tx.select({ status: runDeliveries.status, receipt: runDeliveries.receipt, deliveredAt: runDeliveries.deliveredAt }).from(runDeliveries).where(and(eq(runDeliveries.id, reference.id), eq(runDeliveries.runId, reference.runId), eq(runDeliveries.workspaceId, DEMO_WORKSPACE_ID))).limit(1);
        const receipt = RunDeliveryReceipt.safeParse(delivery?.receipt);
        originalResolved = delivery?.status === "delivered" && delivery.deliveredAt !== null && receipt.success && receipt.data.deliveryId === reference.id;
      }
      const transition = attentionHandlingTransition(row.status, input, sourceState, unresolved.length > 0, originalResolved);
      if (!transition.ok) throw new HandlingConflict(transition.error);
      const now = new Date();
      const entry = AttentionHandlingEntry.parse({ requestId: input.requestId, requestHash, action: input.action, reason: input.reason, createdBy: DEMO_USER_ID, createdAt: now.toISOString() });
      if (history.length >= MAX_ATTENTION_HANDLING_ENTRIES) throw new HandlingConflict("处理历史已达到上限，不能覆盖旧记录");
      const entries = AttentionHandlingHistory.parse([...history, entry]);
      const [saved] = await tx.update(attentionCases).set({ status: transition.status, revision: row.revision + 1, entries, updatedAt: now,
        closedAt: transition.status === "closed" ? row.closedAt ?? now : null }).where(and(eq(attentionCases.id, row.id), eq(attentionCases.workspaceId, DEMO_WORKSPACE_ID), eq(attentionCases.revision, row.revision))).returning();
      if (!saved) throw new HandlingConflict("处理记录已被更新，请刷新后再提交");
      return AttentionHandlingResult.parse({ ok: true, recorded: true, item: await presentAttentionCase(saved, tx) });
    });
  } catch (error) {
    if (error instanceof HandlingConflict) return { ok: false, error: error.message };
    console.error("处理记录保存结果待确认", safeErrorForLog(error));
    return { ok: false, error: "处理记录暂时无法确认，请沿用原请求重试", retryable: true };
  }
}
