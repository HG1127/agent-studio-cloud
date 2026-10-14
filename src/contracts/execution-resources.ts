import { z } from "zod";
import { AttentionIdentifier } from "./attention-reference";

export const ExecutionResourceCount = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const ExecutionResourceRawCount = z.string().regex(/^\d+$/).transform(Number).pipe(ExecutionResourceCount);
export const ExecutionPolicyRevision = z.number().int().min(0).max(2_147_483_647);
export const ExecutionRunLimits = z.object({
  maxModelCalls: z.number().int().min(1).max(10_000),
  maxChildRuns: z.number().int().min(0).max(199),
}).strict();
export type ExecutionRunLimits = z.infer<typeof ExecutionRunLimits>;
export const ExecutionResourceLimits = ExecutionRunLimits.extend({ maxConcurrentChains: z.number().int().min(1).max(2_000) }).strict();
export type ExecutionResourceLimits = z.infer<typeof ExecutionResourceLimits>;
export const DEFAULT_EXECUTION_RESOURCE_LIMITS = ExecutionResourceLimits.parse({ maxConcurrentChains: 50, maxModelCalls: 200, maxChildRuns: 100 });
export const ExecutionResourceSnapshot = z.object({
  version: z.literal("v1"), policyRevision: ExecutionPolicyRevision,
  limits: ExecutionRunLimits, coverage: z.enum(["new-root", "legacy-or-partial"]), frozenAt: z.string().datetime(),
}).strict();
export type ExecutionResourceSnapshot = z.infer<typeof ExecutionResourceSnapshot>;
export const ExecutionPolicyRecord = z.object({
  id: AttentionIdentifier, revision: ExecutionPolicyRevision.refine((value) => value > 0),
  limits: ExecutionResourceLimits, updatedAt: z.date(), archivedAt: z.date().nullable(),
}).strict();
export type ExecutionPolicyRecord = z.infer<typeof ExecutionPolicyRecord>;
export const ExecutionPolicyView = z.object({
  revision: ExecutionPolicyRevision, source: z.enum(["default", "configured"]), limits: ExecutionResourceLimits,
  updatedAt: z.string().datetime().nullable(),
}).strict().superRefine((value, ctx) => {
  if ((value.source === "default") !== (value.revision === 0 && value.updatedAt === null)
    || (value.source === "configured" && (value.revision === 0 || value.updatedAt === null))) {
    ctx.addIssue({ code: "custom", message: "资源设置来源与版本不一致" });
  }
});
export type ExecutionPolicyView = z.infer<typeof ExecutionPolicyView>;
export const ExecutionCapacityCounts = z.object({ reservedChains: ExecutionResourceRawCount, untrackedActiveRuns: ExecutionResourceRawCount }).strict();
export type ExecutionCapacityCounts = z.infer<typeof ExecutionCapacityCounts>;
export const ExecutionCapacityView = z.object({
  reservedChains: ExecutionResourceCount, untrackedActiveRuns: ExecutionResourceCount, availableSlots: ExecutionResourceCount,
}).strict().superRefine((value, ctx) => {
  if (value.untrackedActiveRuns > value.reservedChains) ctx.addIssue({ code: "custom", message: "未知名额不能超过保留名额" });
});
export type ExecutionCapacityView = z.infer<typeof ExecutionCapacityView>;
export const ExecutionPolicySnapshot = z.object({
  policy: ExecutionPolicyView, capacity: ExecutionCapacityView, assessedAt: z.string().datetime(),
}).strict().superRefine((value, ctx) => {
  if (value.capacity.availableSlots !== Math.max(0, value.policy.limits.maxConcurrentChains - value.capacity.reservedChains)) {
    ctx.addIssue({ code: "custom", message: "可用名额与资源设置不一致" });
  }
});
export type ExecutionPolicySnapshot = z.infer<typeof ExecutionPolicySnapshot>;
export const ExecutionResourceLimit = z.object({
  kind: z.enum(["concurrent-chains", "model-calls", "child-runs"]), current: ExecutionResourceCount, maximum: ExecutionResourceCount,
}).strict().superRefine((value, ctx) => {
  if (value.current < value.maximum) ctx.addIssue({ code: "custom", message: "未达到上限不能声明拒绝" });
  const validMaximum = value.kind === "child-runs" ? value.maximum <= 199 : value.maximum >= 1 && value.maximum <= (value.kind === "model-calls" ? 10_000 : 2_000);
  if (!validMaximum) ctx.addIssue({ code: "custom", message: "资源上限超出支持范围" });
});
export type ExecutionResourceLimit = z.infer<typeof ExecutionResourceLimit>;
export const ExecutionResourceAdmission = z.discriminatedUnion("allowed", [
  z.object({ allowed: z.literal(true) }).strict(), z.object({ allowed: z.literal(false), limit: ExecutionResourceLimit }).strict(),
]);
export type ExecutionResourceAdmission = z.infer<typeof ExecutionResourceAdmission>;
export const ExecutionPolicyInput = z.object({
  requestId: AttentionIdentifier, expectedRevision: ExecutionPolicyRevision.refine((value) => value < 2_147_483_647),
  confirmed: z.literal(true), limits: ExecutionResourceLimits, reason: z.string().trim().min(1).max(2_000),
}).strict();
export type ExecutionPolicyInput = z.infer<typeof ExecutionPolicyInput>;
export const ExecutionPolicyChangeView = z.object({
  id: AttentionIdentifier, requestId: AttentionIdentifier, revision: ExecutionPolicyRevision.refine((value) => value > 0),
  previousLimits: ExecutionResourceLimits, limits: ExecutionResourceLimits, reason: z.string().min(1).max(2_000), createdAt: z.string().datetime(),
}).strict();
export type ExecutionPolicyChangeView = z.infer<typeof ExecutionPolicyChangeView>;
export const ExecutionPolicyError = z.object({
  ok: z.literal(false), error: z.string().min(1).max(2_000), retryable: z.literal(true).optional(), conflict: z.literal(true).optional(),
}).strict().superRefine((value, ctx) => { if (value.retryable && value.conflict) ctx.addIssue({ code: "custom", message: "版本冲突不能声明暂时故障" }); });
export const ExecutionPolicyReadResult = z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), snapshot: ExecutionPolicySnapshot }).strict(), ExecutionPolicyError]);
export type ExecutionPolicyReadResult = z.infer<typeof ExecutionPolicyReadResult>;
export const ExecutionPolicyWriteResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), recordedRevision: ExecutionPolicyRevision.refine((value) => value > 0), policy: ExecutionPolicyView }).strict().superRefine((value, ctx) => {
    if (value.policy.revision < value.recordedRevision) ctx.addIssue({ code: "custom", message: "原设置记录不能晚于当前版本" });
  }), ExecutionPolicyError,
]);
export type ExecutionPolicyWriteResult = z.infer<typeof ExecutionPolicyWriteResult>;
export const ExecutionPolicyHistoryInput = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), beforeRevision: z.coerce.number().int().min(1).max(2_147_483_647).optional() }).strict();
export type ExecutionPolicyHistoryInput = z.infer<typeof ExecutionPolicyHistoryInput>;
export const ExecutionPolicyHistoryResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), items: z.array(ExecutionPolicyChangeView).max(50), nextBeforeRevision: ExecutionPolicyRevision.nullable() }).strict().superRefine((value, ctx) => {
    if ((value.nextBeforeRevision !== null && value.nextBeforeRevision !== value.items.at(-1)?.revision)
      || value.items.some((item, index) => index > 0 && item.revision >= value.items[index - 1].revision)) ctx.addIssue({ code: "custom", message: "资源设置历史顺序或游标不一致" });
  }), ExecutionPolicyError,
]);
export type ExecutionPolicyHistoryResult = z.infer<typeof ExecutionPolicyHistoryResult>;
export const MAX_EXECUTION_POLICY_REQUEST_BYTES = 16 * 1024;
