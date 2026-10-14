import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { AttentionIdentifier } from "@/contracts/attention-reference";
import { MAX_MODEL_USAGE_CHAIN_DEPTH, MAX_MODEL_USAGE_CHAIN_RUNS, ModelUsageRunRecord } from "@/contracts/model-usage-chain";
import { runs } from "@/db/schema";
import { modelUsageParent } from "@/server/domain/model-usage-chain";

export type ExecutionResourceTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const selection = { runId: runs.id, parentRunId: runs.parentRunId, sourceType: runs.sourceType, sourceKey: runs.sourceKey, status: runs.status, collaborationTrackingVersion: runs.collaborationTrackingVersion };
const legacyParent = sql<string>`lower(substring(${runs.sourceKey} from '^(?:agent-call|handoff):([0-9a-fA-F-]{36}):'))`;

export async function readExecutionChainGraph(tx: Pick<ExecutionResourceTransaction, "select">, workspaceId: string, runId: string) {
  const workspace = AttentionIdentifier.parse(workspaceId), requested = AttentionIdentifier.parse(runId);
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
  // 宽分支截断也保留原请求及其祖先，统计和准入共用同一关系口径。
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
  return { anchor, rootKnown, flags, included };
}
