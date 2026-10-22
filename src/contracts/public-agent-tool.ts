import { z } from "zod";
import { AgentInputContract } from "./manifest";
import { boundedJsonStorageValue, isPassiveJsonData } from "./json";
import { MAX_RUN_INPUT_BYTES, MAX_RUN_RESULT_BYTES, RunInputPayload, RunStatus } from "./run";
import { WorkflowDraft } from "./workflow";

export const MAX_PUBLIC_TOOL_MANAGE_BYTES = 8 * 1024;
export const MAX_PUBLIC_TOOL_REQUEST_BYTES = MAX_RUN_INPUT_BYTES + 4096;
export const MAX_PUBLIC_TOOL_RECEIPT_BYTES = MAX_RUN_RESULT_BYTES + 16 * 1024;
const PublicToolId = z.string().uuid().transform((value) => value.toLowerCase());
const PublicToolText = z.string().trim().min(1).max(200);
export const PublicToolReference = z.object({ toolId: PublicToolId }).strict();
export type PublicToolReference = z.infer<typeof PublicToolReference>;
export const PublicToolCallReference = PublicToolReference.extend({ requestId: PublicToolId }).strict();
export type PublicToolCallReference = z.infer<typeof PublicToolCallReference>;
export const PublicToolPublication = z.object({
  publicationId: PublicToolId, agentId: PublicToolId, versionId: PublicToolId, version: z.number().int().positive(),
  manifestHash: z.string().regex(/^[a-f0-9]{64}$/), workflowFingerprint: z.string().min(1).max(200),
  inputContract: AgentInputContract, outputContract: WorkflowDraft.shape.outputContract.unwrap(),
  publishedAt: z.string().datetime(),
}).strict();
export type PublicToolPublication = z.infer<typeof PublicToolPublication>;
export const PublicToolPublishedVersion = PublicToolPublication.omit({ manifestHash: true, workflowFingerprint: true }).strip();
export type PublicToolPublishedVersion = z.infer<typeof PublicToolPublishedVersion>;
export const PublicToolKeyView = z.object({
  keyId: PublicToolId, name: PublicToolText, expiresAt: z.string().datetime().nullable(), revokedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
}).strict();
export type PublicToolKeyView = z.infer<typeof PublicToolKeyView>;
export const PublicToolView = PublicToolReference.extend({
  name: PublicToolText, description: z.string().trim().max(2000),
  status: z.enum(["draft", "enabled", "disabled"]), revision: z.number().int().positive(),
  publication: PublicToolPublishedVersion.nullable(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
}).strict().superRefine((value, context) => {
  if (value.status === "enabled" && !value.publication) context.addIssue({ code: "custom", message: "已开放工具必须具备发布绑定" });
});
export type PublicToolView = z.infer<typeof PublicToolView>;
const PublicToolCommandBase = z.object({ requestId: PublicToolId, confirmed: z.literal(true) });
const PublicToolChangeBase = PublicToolCommandBase.extend({ toolId: PublicToolId, expectedRevision: z.number().int().positive() });
export const PublicToolCreateInput = PublicToolCommandBase.extend({
  operation: z.literal("create"), name: PublicToolText, description: z.string().trim().max(2000).default(""),
}).strict();
export type PublicToolCreateInput = z.infer<typeof PublicToolCreateInput>;
export const PublicToolManageInput = z.discriminatedUnion("operation", [
  PublicToolCreateInput,
  PublicToolChangeBase.extend({ operation: z.literal("publish"), agentId: PublicToolId, versionId: PublicToolId }).strict(),
  PublicToolChangeBase.extend({ operation: z.literal("disable") }).strict(),
  PublicToolChangeBase.extend({ operation: z.literal("mint-key"), name: PublicToolText, expiresAt: z.string().datetime().nullable() }).strict(),
  PublicToolChangeBase.extend({ operation: z.literal("revoke-key"), keyId: PublicToolId }).strict(),
]);
export type PublicToolManageInput = z.infer<typeof PublicToolManageInput>;
export const PublicToolFailure = z.object({
  ok: z.literal(false), code: z.enum(["unauthorized", "invalid", "conflict", "not_found", "unavailable", "resource_limit"]),
  error: z.string().min(1).max(300), retryable: z.boolean().optional(),
}).strict();
export type PublicToolFailure = z.infer<typeof PublicToolFailure>;
export const PublicToolManageResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), tool: PublicToolView, recordedRevision: z.number().int().positive(),
    key: PublicToolKeyView.optional(), token: z.string().regex(/^pat_[a-f0-9]{64}$/).optional(),
  }).strict(), PublicToolFailure,
]);
export type PublicToolManageResult = z.infer<typeof PublicToolManageResult>;
export const PublicToolListResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), tools: z.array(PublicToolView).max(100), truncated: z.boolean() }).strict(), PublicToolFailure,
]);
export type PublicToolListResult = z.infer<typeof PublicToolListResult>;
export const PublicToolReadResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), tool: PublicToolView }).strict(), PublicToolFailure,
]);
export type PublicToolReadResult = z.infer<typeof PublicToolReadResult>;
export const PublicToolCallInput = z.object({ requestId: PublicToolId, input: RunInputPayload }).strict();
export type PublicToolCallInput = z.infer<typeof PublicToolCallInput>;
export const PublicToolCallState = z.union([RunStatus, z.enum(["accepted", "start_unknown", "unknown"])]);
export type PublicToolCallState = z.infer<typeof PublicToolCallState>;
export const PublicToolCallReceipt = PublicToolCallReference.extend({
  origin: z.literal("public-agent-tool"), received: z.literal(true), deliveryConfirmed: z.literal(false),
  publicationId: PublicToolId, version: z.number().int().positive(), state: PublicToolCallState,
  resultAvailable: z.boolean(), result: boundedJsonStorageValue(MAX_RUN_RESULT_BYTES, "工具成果").nullable(),
  error: z.string().max(300).nullable(), receivedAt: z.string().datetime(), statusUrl: z.string().max(200),
}).strict().superRefine((value, context) => {
  if (value.statusUrl !== `/api/public-tools/${value.toolId}/calls/${value.requestId}`) context.addIssue({ code: "custom", message: "工具调用入口不一致" });
  if (value.resultAvailable !== (value.state === "completed")) context.addIssue({ code: "custom", message: "工具成果标记与状态不一致" });
  if (!value.resultAvailable && value.result !== null) context.addIssue({ code: "custom", message: "未成功完成不能返回成果" });
  if (value.resultAvailable && (value.result === null || typeof value.result !== "object" || Array.isArray(value.result) || value.error !== null)) context.addIssue({ code: "custom", message: "成功工具调用必须返回有效成果" });
});
export type PublicToolCallReceipt = z.infer<typeof PublicToolCallReceipt>;
export const PublicToolCallResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), call: PublicToolCallReceipt }).strict(), PublicToolFailure,
]);
export type PublicToolCallResult = z.infer<typeof PublicToolCallResult>;
export const PublicToolAuthorization = z.object({ toolId: PublicToolId, keyId: PublicToolId, workspaceId: PublicToolId }).strict();
export type PublicToolAuthorization = z.infer<typeof PublicToolAuthorization>;
export const PublicToolStoredCall = PublicToolCallReference.extend({
  callId: PublicToolId, origin: z.literal("public-agent-tool"), publication: PublicToolPublication,
  requestHash: z.string().regex(/^[a-f0-9]{64}$/), runId: PublicToolId.nullable(), receivedAt: z.string().datetime(),
}).strict();
export type PublicToolStoredCall = z.infer<typeof PublicToolStoredCall>;
export function publicToolResponseFits(value: unknown): boolean {
  return isPassiveJsonData(value, MAX_PUBLIC_TOOL_RECEIPT_BYTES)
    && new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_PUBLIC_TOOL_RECEIPT_BYTES;
}
