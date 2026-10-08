import { AttentionIdentifier } from "@/contracts/attention-reference";
import { MAX_MODEL_USAGE_CHAIN_DEPTH, MAX_MODEL_USAGE_CHAIN_RUNS, ModelUsageParent, ModelUsageRunRecord, RunModelUsageChain, type ModelUsageChainFlags, type ModelUsageChainRun } from "@/contracts/model-usage-chain";

export function modelUsageParent(row: ModelUsageRunRecord): ModelUsageParent {
  const expected = row.sourceType === "agent_call" ? "agent-call" : row.sourceType === "handoff" ? "handoff" : null;
  const matched = expected ? new RegExp(`^${expected}:([0-9a-f-]{36}):`, "i").exec(row.sourceKey ?? "") : null;
  const parsed = AttentionIdentifier.safeParse(matched?.[1]);
  const legacy = parsed.success ? parsed.data : null;
  if (row.parentRunId !== null) return { parentId: row.parentRunId, relation: legacy === row.parentRunId ? "explicit" : "invalid" };
  if (expected) return { parentId: legacy, relation: legacy ? "legacy" : "invalid" };
  return { parentId: null, relation: ["manual", "schedule", "evaluation"].includes(row.sourceType) ? "root" : "invalid" };
}
export function presentRunModelUsageChain(requestedRunId: string, anchorRunId: string, rootKnown: boolean, flags: ModelUsageChainFlags, nodes: ModelUsageChainRun[], assessedAt: Date): RunModelUsageChain {
  const sum = (values: number[]) => {
    const total = values.reduce((count, value) => count + BigInt(value), BigInt(0));
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("执行链模型用量超过安全数值范围");
    return Number(total);
  };
  const subtotal = (values: Array<number | null>) => values.every((value) => value === null) ? null : sum(values.filter((value): value is number => value !== null));
  const legacyRelationRuns = nodes.filter((node) => node.relation === "legacy").length, invalidRelationRuns = nodes.filter((node) => node.relation === "invalid").length;
  const untrackedRelationRuns = nodes.filter((node) => node.relationTracking !== "tracked-v1").length, untrackedModelRuns = nodes.filter((node) => node.summary.tracking !== "tracked-v1").length;
  const finishedRuns = nodes.filter((node) => ["completed", "failed", "cancelled"].includes(node.status)).length, unknownStatusRuns = nodes.filter((node) => node.status === "unknown").length;
  const liveRuns = nodes.length - finishedRuns - unknownStatusRuns;
  const complete = rootKnown && !flags.missingParent && !flags.cycleDetected && !flags.truncated && legacyRelationRuns === 0 && invalidRelationRuns === 0 && untrackedRelationRuns === 0 && unknownStatusRuns === 0;
  const calls = { total: sum(nodes.map((node) => node.summary.calls.total)), pending: sum(nodes.map((node) => node.summary.calls.pending)), returned: sum(nodes.map((node) => node.summary.calls.returned)), failed: sum(nodes.map((node) => node.summary.calls.failed)) };
  const incompleteCalls = sum(nodes.map((node) => node.summary.usage.incompleteCalls));
  return RunModelUsageChain.parse({ requestedRunId, anchorRunId, rootRunId: rootKnown ? anchorRunId : null, assessedAt: assessedAt.toISOString(), limits: { maxRuns: MAX_MODEL_USAGE_CHAIN_RUNS, maxDepth: MAX_MODEL_USAGE_CHAIN_DEPTH },
    graph: { ...flags, includedRuns: nodes.length, rootKnown, legacyRelationRuns, invalidRelationRuns, untrackedRelationRuns, untrackedModelRuns, unknownStatusRuns, complete },
    execution: { finishedRuns, liveRuns, isFinalSnapshot: complete && liveRuns === 0 }, calls,
    usage: { completeCalls: sum(nodes.map((node) => node.summary.usage.completeCalls)), incompleteCalls, invalidUsageCalls: sum(nodes.map((node) => node.summary.usage.invalidUsageCalls)), inputCalls: sum(nodes.map((node) => node.summary.usage.inputCalls)), outputCalls: sum(nodes.map((node) => node.summary.usage.outputCalls)), knownInputTokens: subtotal(nodes.map((node) => node.summary.usage.knownInputTokens)), knownOutputTokens: subtotal(nodes.map((node) => node.summary.usage.knownOutputTokens)), knownCallTotalTokens: subtotal(nodes.map((node) => node.summary.usage.knownCallTotalTokens)), recordedUsageComplete: complete && untrackedModelRuns === 0 && incompleteCalls === 0 }, runs: nodes,
  });
}
