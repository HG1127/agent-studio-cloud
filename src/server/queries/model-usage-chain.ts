import { AttentionIdentifier } from "@/contracts/attention-reference";
import { RunModelUsageAggregate } from "@/contracts/model-usage";
import { type ModelUsageChainRun, type RunModelUsageChain } from "@/contracts/model-usage-chain";
import { RunStatus } from "@/contracts/run";
import { db } from "@/lib/db";
import { modelUsageParent, presentRunModelUsageChain } from "@/server/domain/model-usage-chain";
import { presentRunModelUsage } from "@/server/domain/model-usage";
import { runModelUsageSnapshotQuery } from "./model-usage";
import { readExecutionChainGraph } from "@/server/services/execution-chain-graph";

export async function getRunModelUsageChain(workspaceId: string, runId: string, assessedAt = new Date()): Promise<RunModelUsageChain | null> {
  const workspace = AttentionIdentifier.parse(workspaceId), requested = AttentionIdentifier.parse(runId);
  assessedAt.toISOString();
  return db.transaction(async (tx) => {
    const graph = await readExecutionChainGraph(tx, workspace, requested);
    if (!graph) return null;
    const { anchor, rootKnown, flags, included } = graph;
    const aggregates = await tx.execute(runModelUsageSnapshotQuery(workspace, [...included.keys()]));
    const summaries = new Map<string, ReturnType<typeof presentRunModelUsage>>();
    for (const raw of aggregates) {
      const row = RunModelUsageAggregate.parse(raw);
      if (!included.has(row.runId) || summaries.has(row.runId)) throw new Error("执行链用量范围不一致");
      summaries.set(row.runId, presentRunModelUsage(row, assessedAt));
    }
    if (summaries.size !== included.size) throw new Error("执行链用量记录不完整");
    const nodes = [...included.values()].map<ModelUsageChainRun>(({ row, depth }) => {
      const parent = modelUsageParent(row), status = RunStatus.safeParse(row.status);
      return { parentRunId: depth === 0 || parent.parentId === null || !included.has(parent.parentId) ? null : parent.parentId, depth,
        status: status.success ? status.data : "unknown", relation: parent.relation, relationTracking: row.collaborationTrackingVersion === "v1" ? "tracked-v1" : "legacy-or-partial", summary: summaries.get(row.runId)! };
    }).sort((left, right) => left.depth - right.depth || left.summary.runId.localeCompare(right.summary.runId));
    return presentRunModelUsageChain(requested, anchor, rootKnown, flags, nodes, assessedAt);
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
