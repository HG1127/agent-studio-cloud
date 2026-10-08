import { z } from "zod";
import { AttentionIdentifier, AttentionKind, AttentionReference } from "./attention-reference";

export const MAX_ATTENTION_HANDLING_ENTRIES = 100;
export const MAX_ATTENTION_HANDLING_BODY_BYTES = 8192;
export const AttentionHandlingStatus = z.enum(["open", "in-progress", "closed"]);
export type AttentionHandlingStatus = z.infer<typeof AttentionHandlingStatus>;
export const AttentionSourceState = z.enum(["active", "changed", "inactive"]);
export type AttentionSourceState = z.infer<typeof AttentionSourceState>;
export const AttentionHandlingSummary = z.object({
  caseId: AttentionIdentifier.nullable(), status: AttentionHandlingStatus, revision: z.number().int().min(0),
  entryCount: z.number().int().min(0).max(MAX_ATTENTION_HANDLING_ENTRIES), updatedAt: z.string().datetime().nullable(), closedAt: z.string().datetime().nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.revision !== value.entryCount || (value.status === "closed") !== (value.closedAt !== null)
    || (!value.caseId && (value.status !== "open" || value.revision !== 0 || value.updatedAt !== null))
    || (value.caseId && value.updatedAt === null)) ctx.addIssue({ code: "custom", message: "处理摘要与历史或关闭状态不一致" });
});
export type AttentionHandlingSummary = z.infer<typeof AttentionHandlingSummary>;
const common = { reference: AttentionReference, requestId: AttentionIdentifier, expectedRevision: z.number().int().min(0), reason: z.string().trim().min(1).max(1000) };
export const AttentionHandlingInput = z.discriminatedUnion("action", [
  z.object({ ...common, action: z.literal("acknowledge") }).strict(),
  z.object({ ...common, action: z.literal("note") }).strict(),
  z.object({ ...common, action: z.literal("reopen") }).strict(),
  z.object({ ...common, action: z.literal("close-resolved"), confirmedReviewed: z.literal(true) }).strict(),
  z.object({ ...common, action: z.literal("accept-failure"), confirmedReviewed: z.literal(true), confirmedNoRetry: z.literal(true) }).strict(),
]);
export type AttentionHandlingInput = z.infer<typeof AttentionHandlingInput>;
export const AttentionHandlingEntry = z.object({
  requestId: AttentionIdentifier, action: z.enum(["acknowledge", "note", "reopen", "close-resolved", "accept-failure"]),
  reason: z.string().trim().min(1).max(1000), createdBy: AttentionIdentifier, createdAt: z.string().datetime(),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type AttentionHandlingEntry = z.infer<typeof AttentionHandlingEntry>;
export const AttentionHandlingPublicEntry = AttentionHandlingEntry.omit({ requestHash: true });
export type AttentionHandlingPublicEntry = z.infer<typeof AttentionHandlingPublicEntry>;
export const AttentionHandlingHistory = z.array(AttentionHandlingEntry).max(MAX_ATTENTION_HANDLING_ENTRIES).superRefine((entries, ctx) => {
  if (new Set(entries.map((entry) => entry.requestId)).size !== entries.length) ctx.addIssue({ code: "custom", message: "处理请求不能重复" });
  if (new TextEncoder().encode(JSON.stringify(entries)).byteLength > 512 * 1024) ctx.addIssue({ code: "custom", message: "处理历史超过容量" });
});
export const AttentionCaseView = z.object({
  id: AttentionIdentifier, reference: AttentionReference, title: z.string().max(500), status: AttentionHandlingStatus,
  revision: z.number().int().min(1), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), closedAt: z.string().datetime().nullable(),
  sourceState: AttentionSourceState, entries: z.array(AttentionHandlingPublicEntry).min(1).max(MAX_ATTENTION_HANDLING_ENTRIES),
}).strict().superRefine((value, ctx) => {
  if (value.revision !== value.entries.length || new Set(value.entries.map((entry) => entry.requestId)).size !== value.entries.length || (value.status === "closed") !== (value.closedAt !== null)) ctx.addIssue({ code: "custom", message: "处理历史与版本或关闭状态不一致" });
});
export type AttentionCaseView = z.infer<typeof AttentionCaseView>;
export const AttentionCaseReference = z.object({ caseId: AttentionIdentifier }).strict();
export type AttentionCaseReference = z.infer<typeof AttentionCaseReference>;
export const AttentionHandlingResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), recorded: z.literal(true), item: AttentionCaseView }).strict(),
  z.object({ ok: z.literal(false), error: z.string().min(1).max(2000), retryable: z.literal(true).optional() }).strict(),
]);
export type AttentionHandlingResult = z.infer<typeof AttentionHandlingResult>;
export const AttentionCaseGetResult = z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), item: AttentionCaseView }).strict(), z.object({ ok: z.literal(false), error: z.string().min(1).max(2000), retryable: z.literal(true).optional() }).strict()]);
export type AttentionCaseGetResult = z.infer<typeof AttentionCaseGetResult>;
export const AttentionCaseListInput = z.object({
  status: AttentionHandlingStatus.optional(), kind: AttentionKind.optional(), runId: AttentionIdentifier.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20), before: z.string().datetime().max(32).optional(), beforeId: AttentionIdentifier.optional(),
}).strict().superRefine((value, ctx) => { if (!!value.before !== !!value.beforeId) ctx.addIssue({ code: "custom", message: "历史翻页须同时提供时间与标识" }); });
export type AttentionCaseListInput = z.infer<typeof AttentionCaseListInput>;
export const AttentionCaseListItem = z.object({ id: AttentionIdentifier, reference: AttentionReference, title: z.string().max(500), status: AttentionHandlingStatus,
  revision: z.number().int().min(1), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), closedAt: z.string().datetime().nullable(), entryCount: z.number().int().min(1).max(MAX_ATTENTION_HANDLING_ENTRIES),
}).strict().superRefine((value, ctx) => { if (value.revision !== value.entryCount || (value.status === "closed") !== (value.closedAt !== null)) ctx.addIssue({ code: "custom", message: "历史摘要与版本或关闭状态不一致" }); });
export type AttentionCaseListItem = z.infer<typeof AttentionCaseListItem>;
export const AttentionCaseListResult = z.object({ ok: z.literal(true), items: z.array(AttentionCaseListItem).max(50), nextCursor: z.object({ createdAt: z.string().datetime().max(32), id: AttentionIdentifier }).strict().nullable() }).strict().superRefine((value, ctx) => {
  if (new Set(value.items.map((item) => item.id)).size !== value.items.length) ctx.addIssue({ code: "custom", message: "处理历史记录不能重复" });
  if (!value.nextCursor) return;
  const last = value.items.at(-1);
  if (!last || last.id !== value.nextCursor.id || last.createdAt !== value.nextCursor.createdAt) ctx.addIssue({ code: "custom", path: ["nextCursor"], message: "历史翻页游标须来自最后一条记录" });
});
export type AttentionCaseListResult = z.infer<typeof AttentionCaseListResult>;
