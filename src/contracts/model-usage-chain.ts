import { z } from "zod";
import { AttentionIdentifier } from "./attention-reference";
import { ModelCallCounts, ModelTokenCount, ModelUsageTotals, RunModelUsage } from "./model-usage";
import { RunStatus } from "./run";

export const MAX_MODEL_USAGE_CHAIN_RUNS = 200;
export const MAX_MODEL_USAGE_CHAIN_DEPTH = 8;
export const ModelUsageRunRelation = z.enum(["root", "explicit", "legacy", "invalid"]);
export type ModelUsageRunRelation = z.infer<typeof ModelUsageRunRelation>;
export const ModelUsageRunRecord = z.object({ runId: AttentionIdentifier, parentRunId: AttentionIdentifier.nullable(), sourceType: z.string(), sourceKey: z.string().nullable(), status: z.string(), collaborationTrackingVersion: z.string().nullable() }).strict();
export type ModelUsageRunRecord = z.infer<typeof ModelUsageRunRecord>;
export const ModelUsageParent = z.object({ parentId: AttentionIdentifier.nullable(), relation: ModelUsageRunRelation }).strict();
export type ModelUsageParent = z.infer<typeof ModelUsageParent>;
export const ModelUsageChainRun = z.object({
  parentRunId: AttentionIdentifier.nullable(), depth: z.number().int().min(0).max(MAX_MODEL_USAGE_CHAIN_DEPTH),
  status: z.enum([...RunStatus.options, "unknown"]), relation: ModelUsageRunRelation,
  relationTracking: z.enum(["tracked-v1", "legacy-or-partial"]), summary: RunModelUsage,
}).strict();
export type ModelUsageChainRun = z.infer<typeof ModelUsageChainRun>;
export const ModelUsageChainFlags = z.object({ missingParent: z.boolean(), cycleDetected: z.boolean(), truncated: z.boolean() }).strict();
export type ModelUsageChainFlags = z.infer<typeof ModelUsageChainFlags>;
export const RunModelUsageChain = z.object({
  requestedRunId: AttentionIdentifier, anchorRunId: AttentionIdentifier, rootRunId: AttentionIdentifier.nullable(), assessedAt: z.string().datetime(),
  limits: z.object({ maxRuns: z.literal(MAX_MODEL_USAGE_CHAIN_RUNS), maxDepth: z.literal(MAX_MODEL_USAGE_CHAIN_DEPTH) }).strict(),
  graph: ModelUsageChainFlags.extend({ includedRuns: ModelTokenCount, rootKnown: z.boolean(), legacyRelationRuns: ModelTokenCount, invalidRelationRuns: ModelTokenCount, untrackedRelationRuns: ModelTokenCount, untrackedModelRuns: ModelTokenCount, unknownStatusRuns: ModelTokenCount, complete: z.boolean() }).strict(),
  execution: z.object({ liveRuns: ModelTokenCount, finishedRuns: ModelTokenCount, isFinalSnapshot: z.boolean() }).strict(),
  calls: ModelCallCounts, usage: ModelUsageTotals, runs: z.array(ModelUsageChainRun).min(1).max(MAX_MODEL_USAGE_CHAIN_RUNS),
}).strict().superRefine((value, ctx) => {
  const { graph, execution, runs, calls, usage } = value, ids = new Set(runs.map((run) => run.summary.runId));
  const byId = new Map(runs.map((run) => [run.summary.runId, run]));
  const roots = runs.filter((run) => run.depth === 0);
  const finished = runs.filter((run) => ["completed", "failed", "cancelled"].includes(run.status)).length;
  const unknown = runs.filter((run) => run.status === "unknown").length;
  const live = runs.length - finished - unknown;
  const complete = graph.rootKnown && !graph.missingParent && !graph.cycleDetected && !graph.truncated && graph.legacyRelationRuns === 0 && graph.invalidRelationRuns === 0 && graph.untrackedRelationRuns === 0 && unknown === 0;
  const sum = (values: number[]) => values.reduce((total, count) => total + BigInt(count), BigInt(0));
  const subtotal = (values: Array<number | null>) => values.every((count) => count === null) ? null : sum(values.filter((count): count is number => count !== null));
  let invalid = ids.size !== runs.length || !ids.has(value.requestedRunId) || roots.length !== 1 || roots[0]?.summary.runId !== value.anchorRunId || roots[0]?.parentRunId !== null
    || graph.includedRuns !== runs.length || graph.rootKnown !== (value.rootRunId !== null) || (graph.rootKnown && (value.rootRunId !== value.anchorRunId || roots[0]?.relation !== "root"))
    || graph.legacyRelationRuns !== runs.filter((run) => run.relation === "legacy").length || graph.invalidRelationRuns !== runs.filter((run) => run.relation === "invalid").length
    || graph.untrackedRelationRuns !== runs.filter((run) => run.relationTracking !== "tracked-v1").length || graph.untrackedModelRuns !== runs.filter((run) => run.summary.tracking !== "tracked-v1").length
    || graph.unknownStatusRuns !== unknown || graph.complete !== complete || execution.finishedRuns !== finished || execution.liveRuns !== live || execution.isFinalSnapshot !== (complete && live === 0)
    || usage.recordedUsageComplete !== (complete && graph.untrackedModelRuns === 0 && usage.incompleteCalls === 0)
    || runs.some((run) => run.summary.assessedAt !== value.assessedAt || (run.parentRunId !== null && (!ids.has(run.parentRunId) || run.depth !== byId.get(run.parentRunId)!.depth + 1)) || (run.depth > 0 && run.parentRunId === null && run.relation !== "invalid") || (run.relation === "root" && run.depth !== 0));
  for (const key of ["total", "pending", "returned", "failed"] as const) invalid ||= BigInt(calls[key]) !== sum(runs.map((run) => run.summary.calls[key]));
  for (const key of ["completeCalls", "incompleteCalls", "invalidUsageCalls", "inputCalls", "outputCalls"] as const) invalid ||= BigInt(usage[key]) !== sum(runs.map((run) => run.summary.usage[key]));
  for (const key of ["knownInputTokens", "knownOutputTokens", "knownCallTotalTokens"] as const) invalid ||= (usage[key] === null ? null : BigInt(usage[key])) !== subtotal(runs.map((run) => run.summary.usage[key]));
  if (invalid) ctx.addIssue({ code: "custom", message: "执行链用量与关系、覆盖或纳入运行不一致" });
});
export type RunModelUsageChain = z.infer<typeof RunModelUsageChain>;
export const RunModelUsageChainResult = z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), summary: RunModelUsageChain }).strict(), z.object({ ok: z.literal(false), error: z.string().min(1).max(2000), retryable: z.literal(true).optional() }).strict()]);
export type RunModelUsageChainResult = z.infer<typeof RunModelUsageChainResult>;
