import { RunModelUsage } from "../../src/contracts/model-usage";
import type { ModelUsageChainFlags, ModelUsageChainRun } from "../../src/contracts/model-usage-chain";
import { presentRunModelUsageChain } from "../../src/server/domain/model-usage-chain";

export const usageRunId = "00000000-0000-4000-8000-000000000091";
export const usageChildId = "00000000-0000-4000-8000-000000000092";
export const usageDate = "2026-10-09T10:00:00.000Z";

export function usageFixture(patch: Partial<Omit<RunModelUsage, "calls" | "usage">> & {
  calls?: Partial<RunModelUsage["calls"]>; usage?: Partial<RunModelUsage["usage"]>;
} = {}): RunModelUsage {
  return RunModelUsage.parse({
    runId: usageRunId, tracking: "tracked-v1", assessedAt: usageDate, ...patch,
    calls: { total: 0, pending: 0, returned: 0, failed: 0, ...patch.calls },
    usage: { completeCalls: 0, incompleteCalls: 0, invalidUsageCalls: 0, inputCalls: 0, outputCalls: 0,
      knownInputTokens: null, knownOutputTokens: null, knownCallTotalTokens: null, recordedUsageComplete: true, ...patch.usage },
  });
}

export function completeUsage(runId = usageRunId, tokens = 10) {
  return usageFixture({ runId, calls: { total: 1, returned: 1 }, usage: { completeCalls: 1, inputCalls: 1, outputCalls: 1,
    knownInputTokens: tokens, knownOutputTokens: 0, knownCallTotalTokens: tokens } });
}

export function chainFixture(options: {
  requestedRunId?: string; rootKnown?: boolean; flags?: Partial<ModelUsageChainFlags>; runs?: ModelUsageChainRun[];
} = {}) {
  const runs = options.runs ?? [{ parentRunId: null, depth: 0, status: "completed" as const, relation: "root" as const,
    relationTracking: "tracked-v1" as const, summary: usageFixture() }];
  return presentRunModelUsageChain(options.requestedRunId ?? runs[0].summary.runId, runs[0].summary.runId, options.rootKnown ?? true,
    { missingParent: false, truncated: false, cycleDetected: false, ...options.flags }, runs, new Date(usageDate));
}
