import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { AttentionIdentifier } from "@/contracts/attention-reference";
import { RunModelUsageAggregate } from "@/contracts/model-usage";
import { MAX_MODEL_USAGE_CHAIN_DEPTH, MAX_MODEL_USAGE_CHAIN_RUNS, ModelUsageRunRecord, type ModelUsageChainRun, type RunModelUsageChain } from "@/contracts/model-usage-chain";
import { RunStatus } from "@/contracts/run";
import { runs } from "@/db/schema";
import { db } from "@/lib/db";
import { modelUsageParent, presentRunModelUsageChain } from "@/server/domain/model-usage-chain";
import { presentRunModelUsage } from "@/server/domain/model-usage";
import { runModelUsageSnapshotQuery } from "./model-usage";

const selection = { runId: runs.id, parentRunId: runs.parentRunId, sourceType: runs.sourceType, sourceKey: runs.sourceKey, status: runs.status, collaborationTrackingVersion: runs.collaborationTrackingVersion };
const legacyParent = sql<string>`lower(substring(${runs.sourceKey} from '^(?:agent-call|handoff):([0-9a-fA-F-]{36}):'))`;
export async function getRunModelUsageChain(workspaceId: string, runId: string, assessedAt = new Date()): Promise<RunModelUsageChain | null> {
  const workspace = AttentionIdentifier.parse(workspaceId), requested = AttentionIdentifier.parse(runId);
  assessedAt.toISOString();
  return db.transaction(async (tx) => {
    const read = async (id: string) => {
      const [row] = await tx.select(selection).from(runs).where(and(eq(runs.workspaceId, workspace), eq(runs.id, id))).limit(1);
      return row ? ModelUsageRunRecord.parse(row) : null;
    };
    const initial = await read(requested);
    if (!initial) return null;
    const path = [initial], seenAncestors = new Set([initial.runId]);
    const flags = { missingParent: false, cycleDetected: false, truncated: false };
    let rootKnown = false;
    for (;;) {
      const parent = modelUsageParent(path.at(-1)!);
      if (parent.parentId === null) { rootKnown = parent.relation === "root"; break; }
      if (seenAncestors.has(parent.parentId)) { flags.cycleDetected = true; break; }
      if (path.length > MAX_MODEL_USAGE_CHAIN_DEPTH) { flags.truncated = true; break; }
      const row = await read(parent.parentId);
      if (!row) { flags.missingParent = true; break; }
      seenAncestors.add(row.runId); path.push(row);
    }
    path.reverse();
    const anchor = path[0].runId;
    // 先纳入已确认祖先路径，宽分支截断也不能把用户查询的原运行丢掉。
    const included = new Map(path.map((row, depth) => [row.runId, { row, depth }]));
    let frontier = [anchor];
    for (let depth = 0; depth <= MAX_MODEL_USAGE_CHAIN_DEPTH && frontier.length; depth += 1) {
      const rows = await tx.select(selection).from(runs).where(and(eq(runs.workspaceId, workspace), or(
        inArray(runs.parentRunId, frontier),
        and(isNull(runs.parentRunId), inArray(runs.sourceType, ["agent_call", "handoff"]), inArray(legacyParent, frontier)),
      ))).orderBy(asc(runs.id)).limit(MAX_MODEL_USAGE_CHAIN_RUNS + 1);
      if (rows.length > MAX_MODEL_USAGE_CHAIN_RUNS) flags.truncated = true;
      const next = new Set<string>();
      for (const raw of rows) {
        const row = ModelUsageRunRecord.parse(raw), previous = included.get(row.runId);
        if (previous) {
          if (previous.depth <= depth) flags.cycleDetected = true;
          else if (previous.depth === depth + 1) next.add(row.runId);
          continue;
        }
        if (depth === MAX_MODEL_USAGE_CHAIN_DEPTH || included.size === MAX_MODEL_USAGE_CHAIN_RUNS) { flags.truncated = true; continue; }
        included.set(row.runId, { row, depth: depth + 1 }); next.add(row.runId);
      }
      frontier = [...next];
    }
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
