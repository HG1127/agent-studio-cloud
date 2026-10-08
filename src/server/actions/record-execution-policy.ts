"use server";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { ExecutionPolicyInput, ExecutionPolicyWriteResult, type ExecutionPolicyWriteResult as Result } from "@/contracts/execution-resources";
import { executionPolicies, executionPolicyChanges } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { canonicalJson } from "@/server/domain/canonical-json";
import { presentExecutionPolicy } from "@/server/domain/execution-resources";
import { redactAttentionText } from "@/server/domain/attention";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { lockExecutionWorkspace } from "@/server/services/execution-resources";

class PolicyConflict extends Error {}
export async function recordExecutionPolicyAction(raw: ExecutionPolicyInput): Promise<Result> {
  const parsed = ExecutionPolicyInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "资源设置不完整或未明确确认" };
  const cleaned = ExecutionPolicyInput.safeParse({ ...parsed.data, reason: redactAttentionText(parsed.data.reason) });
  if (!cleaned.success) return { ok: false, error: "设置原因脱敏后超过容量，请精简后重新提交" };
  const input = cleaned.data, requestHash = createHash("sha256").update(canonicalJson(input)).digest("hex");
  try {
    return await db.transaction(async (tx) => {
      await lockExecutionWorkspace(tx, DEMO_WORKSPACE_ID);
      const match = eq(executionPolicies.workspaceId, DEMO_WORKSPACE_ID);
      const [row] = await tx.select({ id: executionPolicies.id, revision: executionPolicies.revision, limits: executionPolicies.limits, updatedAt: executionPolicies.updatedAt, archivedAt: executionPolicies.archivedAt })
        .from(executionPolicies).where(match).for("update").limit(1);
      const policy = presentExecutionPolicy(row ?? null);
      const [previous] = await tx.select({ requestHash: executionPolicyChanges.requestHash, revision: executionPolicyChanges.revision }).from(executionPolicyChanges)
        .where(and(eq(executionPolicyChanges.workspaceId, DEMO_WORKSPACE_ID), eq(executionPolicyChanges.requestId, input.requestId))).limit(1);
      if (previous) {
        if (previous.requestHash !== requestHash) throw new PolicyConflict("同一次设置请求不能更换内容或版本");
        return ExecutionPolicyWriteResult.parse({ ok: true, recordedRevision: previous.revision, policy });
      }
      if (policy.revision !== input.expectedRevision) throw new PolicyConflict("资源设置已被更新，请刷新后再提交");
      const now = new Date(), revision = policy.revision + 1;
      const [saved] = row
        ? await tx.update(executionPolicies).set({ limits: input.limits, revision, updatedAt: now }).where(and(match, eq(executionPolicies.id, row.id), eq(executionPolicies.revision, policy.revision))).returning({ id: executionPolicies.id })
        : await tx.insert(executionPolicies).values({ workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, limits: input.limits, revision, updatedAt: now }).returning({ id: executionPolicies.id });
      if (!saved) throw new PolicyConflict("资源设置已被更新，请刷新后再提交");
      await tx.insert(executionPolicyChanges).values({ workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, policyId: saved.id, requestId: input.requestId, requestHash,
        revision, previousLimits: policy.limits, limits: input.limits, reason: input.reason, createdAt: now, updatedAt: now });
      return ExecutionPolicyWriteResult.parse({ ok: true, recordedRevision: revision, policy: presentExecutionPolicy({ id: saved.id, revision, limits: input.limits, updatedAt: now, archivedAt: null }) });
    });
  } catch (error) {
    if (error instanceof PolicyConflict) return { ok: false, error: error.message, conflict: true };
    console.error("资源设置保存结果待确认", safeErrorForLog(error));
    return { ok: false, error: "资源设置暂时无法确认，请沿用原请求重试", retryable: true };
  }
}
