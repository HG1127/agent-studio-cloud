import { z } from "zod";
import { RunStatus } from "./run";

export const AttentionKind = z.enum(["approval-pending", "approval-resume", "wait-event", "run-failed", "tool-operation", "delivery-failed"]);
export type AttentionKind = z.infer<typeof AttentionKind>;
const Identifier = z.string().uuid().transform((value) => value.toLowerCase());
const Timestamp = z.string().datetime().max(32);
export const AttentionCursor = z.object({ createdAt: Timestamp, id: Identifier, kind: AttentionKind }).strict();
export type AttentionCursor = z.infer<typeof AttentionCursor>;
export const AttentionListInput = z.object({
  kind: AttentionKind.optional(), agentId: Identifier.optional(), runId: Identifier.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  before: Timestamp.optional(), beforeId: Identifier.optional(), beforeKind: AttentionKind.optional(),
}).strict().superRefine((input, context) => {
  const parts = [input.before, input.beforeId, input.beforeKind].filter((value) => value !== undefined).length;
  if (parts !== 0 && parts !== 3) context.addIssue({ code: "custom", message: "翻页时间、标识与类别必须同时提供" });
});
export type AttentionListInput = z.infer<typeof AttentionListInput>;
export const AttentionMetadata = z.object({
  kind: AttentionKind, id: Identifier, runId: Identifier, agentId: Identifier.nullable(),
  agentName: z.string().max(400).nullable(), agentNameTruncated: z.boolean(), runStatus: RunStatus.nullable(),
  title: z.string().max(1000), titleTruncated: z.boolean(), error: z.string().max(4000).nullable(), errorTruncated: z.boolean(),
  createdAt: Timestamp,
}).strict();
export type AttentionMetadata = z.infer<typeof AttentionMetadata>;
export function attentionLinks(kind: AttentionKind, id: string, runId: string) {
  const view = `/runs/${runId}`;
  const detail = kind.startsWith("approval-") ? `/api/runs/${runId}/approvals/${id}`
    : kind === "tool-operation" ? `/api/tool-operations/${id}`
    : kind === "delivery-failed" ? `/api/runs/${runId}/delivery` : `/api/runs/${runId}`;
  return { view, detail };
}
export const AttentionItem = AttentionMetadata.extend({
  agentName: z.string().max(200).nullable(), title: z.string().max(500), error: z.string().max(2000).nullable(),
  summary: z.string().min(1).max(200), links: z.object({ view: z.string().max(200), detail: z.string().max(200) }).strict(),
}).superRefine((item, context) => {
  const expected = attentionLinks(item.kind, item.id, item.runId);
  if (item.links.view !== expected.view || item.links.detail !== expected.detail) context.addIssue({ code: "custom", path: ["links"], message: "待处理入口必须属于原记录" });
  const required = item.kind.startsWith("approval-") ? "waiting_approval" : item.kind === "wait-event" ? "waiting_event" : item.kind === "run-failed" ? "failed" : null;
  if (required && item.runStatus !== required) context.addIssue({ code: "custom", path: ["runStatus"], message: "待处理类别与任务状态不一致" });
  if (["wait-event", "run-failed"].includes(item.kind) && item.id !== item.runId) context.addIssue({ code: "custom", path: ["id"], message: "任务待处理标识必须属于原任务" });
});
export type AttentionItem = z.infer<typeof AttentionItem>;
export const AttentionListResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), items: z.array(AttentionItem).max(50), nextCursor: AttentionCursor.nullable() }).strict().superRefine((result, context) => {
    if (new Set(result.items.map((item) => `${item.kind}:${item.id}`)).size !== result.items.length) context.addIssue({ code: "custom", message: "待处理记录不能重复" });
    if (!result.nextCursor) return;
    const last = result.items.at(-1);
    if (!last || last.id !== result.nextCursor.id || last.kind !== result.nextCursor.kind || last.createdAt !== result.nextCursor.createdAt) context.addIssue({ code: "custom", path: ["nextCursor"], message: "翻页游标必须来自最后一条记录" });
  }),
  z.object({ ok: z.literal(false), error: z.string().min(1).max(2000), retryable: z.literal(true).optional() }).strict(),
]);
export type AttentionListResult = z.infer<typeof AttentionListResult>;
