"use server";

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { ToolOperationResolution, ToolOperationResolveInput, type ToolOperationResolveResult } from "@/contracts/tool-operation";
import { toolOperations } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { canonicalJson } from "@/server/domain/canonical-json";
import { redactCredentialText } from "@/server/domain/security/redact-sensitive";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { toolOperationResolutionIssue, validateToolOperationReceipt } from "@/server/domain/runtime/tool-operation";
import { getToolRegistration } from "@/server/tools/tool-registry";

export async function resolveToolOperationAction(input: ToolOperationResolveInput): Promise<ToolOperationResolveResult> {
  const parsed = ToolOperationResolveInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "核对信息不完整，须填写原因并明确确认业务系统的实际状态" };
  const requestHash = createHash("sha256").update(canonicalJson(parsed.data)).digest("hex");
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.select().from(toolOperations).where(and(
        eq(toolOperations.id, parsed.data.operationId), eq(toolOperations.workspaceId, DEMO_WORKSPACE_ID),
      )).for("update").limit(1);
      if (!row) return { ok: false, error: "业务操作不存在或不可访问" };
      const previous = row.resolutions.find((record) => record.requestId === parsed.data.requestId);
      if (previous) return previous.requestHash === requestHash ? { ok: true } : { ok: false, error: "同一次核对请求不能更换内容" };
      const now = new Date();
      const issue = toolOperationResolutionIssue(row, parsed.data.kind, now);
      if (issue) return { ok: false, error: issue };
      const registration = getToolRegistration(row.toolId);
      if (!registration || registration.action !== row.action) return { ok: false, error: "业务工具配置已变化，请先核对工具配置" };
      if (parsed.data.kind === "retry" && (registration.businessIdempotency !== true || !registration.businessIdempotencyRetentionMs)) {
        return { ok: false, error: "业务工具未确认支持防重，不能重新发送" };
      }
      const receipt = parsed.data.kind === "record-receipt"
        ? validateToolOperationReceipt(parsed.data.receipt, registration.outputSchema, registration.outputSchema) : null;
      if (receipt && !receipt.ok) return { ok: false, error: receipt.error };
      const record = ToolOperationResolution.parse({
        requestId: parsed.data.requestId, requestHash, kind: parsed.data.kind, createdBy: DEMO_USER_ID,
        createdAt: now.toISOString(), reason: redactCredentialText(parsed.data.reason),
      });
      await tx.update(toolOperations).set({
        status: parsed.data.kind === "retry" ? "pending" : "completed",
        receipt: receipt?.ok ? receipt.value : null, error: null, leaseOwner: null, leaseExpiresAt: null,
        resolutions: [...row.resolutions, record], updatedAt: now,
      }).where(and(eq(toolOperations.id, row.id), eq(toolOperations.workspaceId, DEMO_WORKSPACE_ID)));
      return { ok: true };
    });
  } catch (error) {
    console.error("核对业务操作失败", safeErrorForLog(error));
    return { ok: false, error: "核对记录暂时无法保存，请使用同一次请求重试", retryable: true };
  }
}
