import { z } from "zod";
import { AttentionIdentifier } from "./attention-reference";

export const ModelTokenCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export type ModelTokenCount = z.infer<typeof ModelTokenCount>;
export const ModelUsageField = z.enum(["inputTokens", "outputTokens", "cachedInputTokens", "cacheWriteInputTokens", "reasoningOutputTokens", "knownTotalTokens"]);
export type ModelUsageField = z.infer<typeof ModelUsageField>;
export const ModelUsageMeasurement = z.object({
  inputTokens: ModelTokenCount.nullable(), outputTokens: ModelTokenCount.nullable(),
  cachedInputTokens: ModelTokenCount.nullable(), cacheWriteInputTokens: ModelTokenCount.nullable(), reasoningOutputTokens: ModelTokenCount.nullable(),
  knownTotalTokens: ModelTokenCount.nullable(), invalidFields: z.array(ModelUsageField).max(6),
}).strict().superRefine((value, ctx) => {
  const sum = value.inputTokens === null || value.outputTokens === null ? null : value.inputTokens + value.outputTokens;
  const expected = sum !== null && Number.isSafeInteger(sum) ? sum : null;
  if (value.knownTotalTokens !== expected || new Set(value.invalidFields).size !== value.invalidFields.length
    || value.invalidFields.some((field) => value[field] !== null)
    || (sum !== null && !Number.isSafeInteger(sum) && !value.invalidFields.includes("knownTotalTokens"))
    || (value.cachedInputTokens !== null && value.inputTokens !== null && value.cachedInputTokens > value.inputTokens)
    || (value.cacheWriteInputTokens !== null && value.inputTokens !== null && value.cacheWriteInputTokens > value.inputTokens)
    || (value.reasoningOutputTokens !== null && value.outputTokens !== null && value.reasoningOutputTokens > value.outputTokens)) ctx.addIssue({ code: "custom", message: "模型报告用量的总量或细分不一致" });
});
export type ModelUsageMeasurement = z.infer<typeof ModelUsageMeasurement>;
export const ModelCallState = z.enum(["pending", "returned", "failed"]);
export type ModelCallState = z.infer<typeof ModelCallState>;
export const ModelCallFailure = z.enum(["aborted", "rate-limited", "provider-unavailable", "provider-rejected", "unknown"]);
export type ModelCallFailure = z.infer<typeof ModelCallFailure>;
export const ModelCallStartInput = z.object({
  runId: AttentionIdentifier, nodeId: z.string(), nodeTitle: z.string().min(1).max(400), modelId: z.string().min(1).max(400), connectionId: AttentionIdentifier.nullable(),
}).strict();
export type ModelCallStartInput = z.infer<typeof ModelCallStartInput>;
export const ModelCallIdentity = z.object({ id: AttentionIdentifier, workspaceId: AttentionIdentifier, runId: AttentionIdentifier }).strict();
export type ModelCallIdentity = z.infer<typeof ModelCallIdentity>;
export const ModelCallSettlement = ModelCallIdentity.extend({ state: z.enum(["returned", "failed"]), measurement: ModelUsageMeasurement.nullable(), failure: ModelCallFailure.nullable() })
  .superRefine((value, ctx) => {
    if ((value.state === "returned") !== (value.measurement !== null) || (value.state === "failed") !== (value.failure !== null)) ctx.addIssue({ code: "custom", message: "模型调用结果与用量状态不一致" });
  });
export type ModelCallSettlement = z.infer<typeof ModelCallSettlement>;
const RawCount = z.string().regex(/^(0|[1-9][0-9]*)$/).transform(Number).pipe(ModelTokenCount);
export const RunModelUsageAggregate = z.object({
  runId: AttentionIdentifier, trackingVersion: z.string().nullable(), calls: RawCount, pending: RawCount, returned: RawCount, failed: RawCount,
  completeCalls: RawCount, invalidUsageCalls: RawCount, inputCalls: RawCount, outputCalls: RawCount,
  knownInputTokens: RawCount.nullable(), knownOutputTokens: RawCount.nullable(), knownCallTotalTokens: RawCount.nullable(),
}).strict();
export type RunModelUsageAggregate = z.infer<typeof RunModelUsageAggregate>;
export const ModelCallCounts = z.object({ total: ModelTokenCount, pending: ModelTokenCount, returned: ModelTokenCount, failed: ModelTokenCount }).strict();
export type ModelCallCounts = z.infer<typeof ModelCallCounts>;
export const ModelUsageTotals = z.object({
    completeCalls: ModelTokenCount, incompleteCalls: ModelTokenCount, invalidUsageCalls: ModelTokenCount,
    inputCalls: ModelTokenCount, outputCalls: ModelTokenCount,
    knownInputTokens: ModelTokenCount.nullable(), knownOutputTokens: ModelTokenCount.nullable(), knownCallTotalTokens: ModelTokenCount.nullable(),
    recordedUsageComplete: z.boolean(),
}).strict();
export type ModelUsageTotals = z.infer<typeof ModelUsageTotals>;
export const RunModelUsage = z.object({
  runId: AttentionIdentifier, tracking: z.enum(["tracked-v1", "legacy-or-partial"]), assessedAt: z.string().datetime(),
  calls: ModelCallCounts, usage: ModelUsageTotals,
}).strict().superRefine((value, ctx) => {
  const { calls, usage } = value;
  if (calls.total !== calls.pending + calls.returned + calls.failed || usage.completeCalls + usage.incompleteCalls !== calls.total
    || usage.completeCalls > calls.returned || usage.invalidUsageCalls > usage.incompleteCalls || usage.invalidUsageCalls > calls.returned || usage.inputCalls > calls.returned || usage.outputCalls > calls.returned
    || usage.completeCalls > Math.min(usage.inputCalls, usage.outputCalls)
    || (usage.inputCalls === 0) !== (usage.knownInputTokens === null) || (usage.outputCalls === 0) !== (usage.knownOutputTokens === null)
    || (usage.completeCalls === 0) !== (usage.knownCallTotalTokens === null)
    || usage.recordedUsageComplete !== (value.tracking === "tracked-v1" && usage.incompleteCalls === 0)
    || (usage.recordedUsageComplete && calls.total > 0 && usage.knownCallTotalTokens !== usage.knownInputTokens! + usage.knownOutputTokens!)) ctx.addIssue({ code: "custom", message: "运行用量统计与覆盖或记录不一致" });
});
export type RunModelUsage = z.infer<typeof RunModelUsage>;
export const RunModelUsageResult = z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), summary: RunModelUsage }).strict(), z.object({ ok: z.literal(false), error: z.string().min(1).max(2000), retryable: z.literal(true).optional() }).strict()]);
export type RunModelUsageResult = z.infer<typeof RunModelUsageResult>;
