"use server";
import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { RunTaskReference } from "@/contracts/run-task";
import { RunDeliveryEnvelope, RunDeliveryResolution, RunDeliveryRetryBody, type RunDeliveryRetryResult, RUN_DELIVERY_ATTEMPTS } from "@/contracts/run-delivery";
import { runDeliveries } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { canonicalJson } from "@/server/domain/canonical-json";
import { redactCredentialText } from "@/server/domain/security/redact-sensitive";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { deliveryTargetBinding, getDeliveryTarget } from "@/server/delivery/target-registry";
import { deliveryEnvelopeMatches } from "@/server/domain/runtime/run-delivery";

export async function retryRunDeliveryAction(runId: string, input: RunDeliveryRetryBody): Promise<RunDeliveryRetryResult> {
  const reference = RunTaskReference.safeParse({ runId });
  const parsed = RunDeliveryRetryBody.safeParse(input);
  if (!reference.success || !parsed.success) return { ok: false, error: "须明确确认补投并填写核对原因" };
  const reason = redactCredentialText(parsed.data.reason);
  const requestHash = createHash("sha256").update(canonicalJson({ ...parsed.data, reason })).digest("hex");
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.select().from(runDeliveries).where(and(eq(runDeliveries.runId, reference.data.runId), eq(runDeliveries.workspaceId, DEMO_WORKSPACE_ID), isNull(runDeliveries.archivedAt))).for("update").limit(1);
      if (!row) return { ok: false, error: "投递记录不存在或不可访问" };
      const previous = row.resolutions.find((record) => record.requestId === parsed.data.requestId);
      if (previous) return previous.requestHash === requestHash ? { ok: true, runId: row.runId, deliveryId: row.id, recorded: true } : { ok: false, error: "同一次补投请求不能更改内容" };
      const now = new Date();
      if (row.status !== "failed" || !row.payload) return { ok: false, error: "只有已经停止且成果完整的投递才能补投" };
      const payload = RunDeliveryEnvelope.safeParse(row.payload);
      if (!payload.success || !deliveryEnvelopeMatches(payload.data, row.id, row.runId)) return { ok: false, error: "投递快照不完整或归属不正确，不能补投" };
      if (row.resolutions.length >= 20) return { ok: false, error: "人工补投次数已达到上限" };
      if (row.retryDeadline && row.retryDeadline <= now) return { ok: false, error: "接收方防重有效期已过，不能再次发送" };
      const target = getDeliveryTarget(row.targetId);
      if (!target || deliveryTargetBinding(target).targetHash !== row.targetHash) return { ok: false, error: "接收方配置已变化，请先人工核对" };
      const record = RunDeliveryResolution.parse({ requestId: parsed.data.requestId, requestHash, reason, createdBy: DEMO_USER_ID, createdAt: now.toISOString() });
      await tx.update(runDeliveries).set({ status: "pending", error: null, maxAttempts: Math.min(105, row.maxAttempts + RUN_DELIVERY_ATTEMPTS),
        nextAttemptAt: now, leaseOwner: null, leaseExpiresAt: null, workflowRunId: null, resolutions: [...row.resolutions, record], updatedAt: now }).where(eq(runDeliveries.id, row.id));
      return { ok: true, runId: row.runId, deliveryId: row.id, recorded: true };
    });
  } catch (error) {
    console.error("补投结果待核对", safeErrorForLog(error));
    return { ok: false, error: "补投记录暂时无法确认，请沿用原请求重试", retryable: true };
  }
}
