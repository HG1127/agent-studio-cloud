import { z } from "zod";
import { InputValueSource } from "./input-mapping";
import { boundedJsonStorageValue, JsonStorageRecord } from "./json";

export const ToolOperationConfig = z.object({
  scope: z.string().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  key: InputValueSource,
}).strict();
export type ToolOperationConfig = z.infer<typeof ToolOperationConfig>;
export const ToolOperationPayload = boundedJsonStorageValue(512 * 1024, "业务操作请求").pipe(z.object({
  action: z.string().min(1).max(128), input: JsonStorageRecord, outputs: JsonStorageRecord,
}).strict());
export type ToolOperationPayload = z.infer<typeof ToolOperationPayload>;
export const MAX_TOOL_OPERATION_RECEIPT_BYTES = 1024 * 1024;
export const MAX_TOOL_OPERATION_RESOLVE_BYTES = MAX_TOOL_OPERATION_RECEIPT_BYTES + 4096;
export const ToolOperationReceipt = boundedJsonStorageValue(MAX_TOOL_OPERATION_RECEIPT_BYTES, "业务操作回执").pipe(JsonStorageRecord);
export type ToolOperationReceipt = z.infer<typeof ToolOperationReceipt>;
export const ToolOperationStatus = z.enum(["pending", "completed", "blocked"]);
export type ToolOperationStatus = z.infer<typeof ToolOperationStatus>;
export const ToolOperationInvocation = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), output: ToolOperationReceipt, operationId: z.string().uuid(), reused: z.boolean(), confirmedByHuman: z.boolean().optional() }),
  z.object({ ok: z.literal(false), error: z.string(), retryable: z.boolean(), retryAfterMs: z.number().int().positive().optional() }),
]);
export type ToolOperationInvocation = z.infer<typeof ToolOperationInvocation>;
export const ToolOperationTraceData = z.object({ operationId: z.string().uuid(), reused: z.boolean(), confirmedByHuman: z.boolean() });
export type ToolOperationTraceData = z.infer<typeof ToolOperationTraceData>;
export const ToolOperationResolution = z.object({
  requestId: z.string().uuid(), kind: z.enum(["retry", "record-receipt"]), createdBy: z.string().uuid(),
  createdAt: z.string().datetime(), reason: z.string().min(1).max(2000), requestHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ToolOperationResolution = z.infer<typeof ToolOperationResolution>;
const resolutionFields = { operationId: z.string().uuid(), requestId: z.string().uuid(), reason: z.string().trim().min(5).max(500) };
export const ToolOperationResolveInput = z.discriminatedUnion("kind", [
  z.object({ ...resolutionFields, kind: z.literal("retry"), confirmedNotExecuted: z.literal(true) }).strict(),
  z.object({ ...resolutionFields, kind: z.literal("record-receipt"), confirmedCompleted: z.literal(true), receipt: ToolOperationReceipt }).strict(),
]);
export type ToolOperationResolveInput = z.infer<typeof ToolOperationResolveInput>;
export const ToolOperationResolveResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }), z.object({ ok: z.literal(false), error: z.string(), retryable: z.boolean().optional() }),
]);
export type ToolOperationResolveResult = z.infer<typeof ToolOperationResolveResult>;
export const ToolOperationView = z.object({
  id: z.string().uuid(), sourceRunId: z.string().uuid(), nodeTitle: z.string(), toolId: z.string(),
  status: ToolOperationStatus, error: z.string().nullable(), receipt: ToolOperationReceipt.nullable(),
  retryDeadline: z.string().datetime(), resolutions: z.array(ToolOperationResolution).max(50).default([]),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export type ToolOperationView = z.infer<typeof ToolOperationView>;
export const ToolOperationReference = z.object({ operationId: z.string().uuid() });
export type ToolOperationReference = z.infer<typeof ToolOperationReference>;
export const ToolOperationGetResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), operation: ToolOperationView }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type ToolOperationGetResult = z.infer<typeof ToolOperationGetResult>;
export const ToolOperationCursor = z.object({ createdAt: z.string().datetime(), id: z.string().uuid() });
export type ToolOperationCursor = z.infer<typeof ToolOperationCursor>;
export const ToolOperationListInput = z.object({
  status: ToolOperationStatus.optional(), sourceRunId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  before: z.string().datetime().optional(), beforeId: z.string().uuid().optional(),
}).strict().superRefine((input, context) => {
  if ((input.before === undefined) !== (input.beforeId === undefined)) {
    context.addIssue({ code: "custom", message: "翻页时间与标识必须同时提供" });
  }
});
export type ToolOperationListInput = z.infer<typeof ToolOperationListInput>;
export const ToolOperationSummary = ToolOperationView.omit({ receipt: true, resolutions: true }).extend({
  resolutionCount: z.number().int().min(0).max(50),
});
export type ToolOperationSummary = z.infer<typeof ToolOperationSummary>;
export const ToolOperationListResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), items: z.array(ToolOperationSummary).max(50), nextCursor: ToolOperationCursor.nullable() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type ToolOperationListResult = z.infer<typeof ToolOperationListResult>;
