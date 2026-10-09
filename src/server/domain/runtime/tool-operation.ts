import { ToolOperationConfig, ToolOperationReceipt, type ToolOperationStatus } from "@/contracts/tool-operation";
import type { WorkflowNode } from "@/contracts/workflow";
import type { InlineOutputReferences } from "@/contracts/inline-output-reference";
import { canonicalJson } from "@/server/domain/canonical-json";
import { validateJsonObjectSchema } from "@/server/domain/json-schema";
import { redactCredentialData } from "@/server/domain/security/redact-sensitive";
import { resolveInputValue } from "./input-mapping";

export const TOOL_OPERATION_LEASE_MS = 120_000;
export function toolOperationKeyMaterial(args: {
  node: Pick<WorkflowNode, "title" | "toolOperation">;
  workspaceId: string; toolId: string; action: string;
  input: Record<string, unknown>; outputs: Record<string, unknown>;
  inlineReferences?: InlineOutputReferences;
}): { ok: true; material: string } | { ok: false; error: string } {
  const config = ToolOperationConfig.safeParse(args.node.toolOperation);
  if (!config.success) return { ok: false, error: `步骤「${args.node.title}」的操作防重配置无效` };
  const value = resolveInputValue(config.data.key, args.input, args.outputs, args.inlineReferences);
  if ((typeof value !== "string" || !value.trim() || value.length > 256)
    && (typeof value !== "number" || !Number.isSafeInteger(value))) {
    return { ok: false, error: `步骤「${args.node.title}」缺少有效的业务操作标识，须使用短文字或安全整数` };
  }
  return { ok: true, material: canonicalJson([args.workspaceId, args.toolId, args.action, config.data.scope, value]) };
}

export function toolOperationDecision(
  row: { requestHash: string; status: ToolOperationStatus; leaseExpiresAt: Date | null },
  requestHash: string, now: Date,
): "conflict" | "cached" | "blocked" | "busy" | "execute" {
  if (row.requestHash !== requestHash) return "conflict";
  if (row.status === "completed") return "cached";
  if (row.status === "blocked") return "blocked";
  if (row.status !== "pending" || (row.leaseExpiresAt && !Number.isFinite(row.leaseExpiresAt.getTime()))) return "blocked";
  return row.leaseExpiresAt && row.leaseExpiresAt.getTime() > now.getTime() ? "busy" : "execute";
}

export function validateToolOperationReceipt(value: unknown, frozenSchema: Record<string, unknown>, currentSchema: Record<string, unknown>):
  | { ok: true; value: ToolOperationReceipt }
  | { ok: false; error: string } {
  const parsed = ToolOperationReceipt.safeParse(value);
  if (!parsed.success) return { ok: false, error: "业务操作回执无法安全保存或超过容量限制" };
  if (Object.hasOwn(parsed.data, "ok") && parsed.data.ok !== true) return { ok: false, error: "业务系统回执表明操作未完成" };
  for (const schema of [frozenSchema, currentSchema]) {
    if (validateJsonObjectSchema(parsed.data, schema)) return { ok: false, error: "业务操作回执不符合字段契约，请核对业务系统结果" };
  }
  const safe = ToolOperationReceipt.parse(redactCredentialData(parsed.data));
  for (const schema of [frozenSchema, currentSchema]) {
    if (validateJsonObjectSchema(safe, schema)) return { ok: false, error: "业务操作回执脱敏后不符合字段契约，请核对业务系统结果" };
  }
  return { ok: true, value: safe };
}

export function toolOperationResolutionIssue(row: {
  status: ToolOperationStatus; leaseExpiresAt: Date | null; retryDeadline: Date; resolutions: unknown[];
}, kind: "retry" | "record-receipt", now: Date): string | null {
  if (row.status === "completed") return "已完成的业务操作不能改写";
  if (row.leaseExpiresAt && row.leaseExpiresAt.getTime() > now.getTime()) return "业务操作仍在执行，请等候结果后核对";
  if (row.resolutions.length >= 50) return "人工核对记录已达上限，请先检查业务处理方式";
  if (kind === "retry" && (!Number.isFinite(row.retryDeadline.getTime()) || row.retryDeadline.getTime() <= now.getTime())) {
    return "业务工具防重有效期已过，不能重新发送，请先核对业务系统并记录实际回执";
  }
  if (!["blocked", "pending"].includes(row.status)) return "业务操作状态不正确，请刷新后核对";
  return null;
}
