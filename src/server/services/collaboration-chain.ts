import { and, eq } from "drizzle-orm";
import { runs } from "@/db/schema";
import { db } from "@/lib/db";
import {
  MAX_COLLABORATION_DEPTH,
  parseCollaborationParentId,
  type CollaborationRunRef,
} from "@/server/domain/runtime/collaboration-chain";

export async function loadCollaborationChain(runId: string, workspaceId: string) {
  const chain: CollaborationRunRef[] = [];
  const seenRunIds = new Set<string>();
  let currentRunId: string | null = runId;

  while (currentRunId && chain.length <= MAX_COLLABORATION_DEPTH) {
    if (seenRunIds.has(currentRunId)) throw new Error("助手协作运行链存在循环");
    seenRunIds.add(currentRunId);
    const [run] = await db
      .select({
        runId: runs.id,
        agentId: runs.agentId,
        sourceType: runs.sourceType,
        sourceKey: runs.sourceKey,
      })
      .from(runs)
      .where(and(eq(runs.id, currentRunId), eq(runs.workspaceId, workspaceId)))
      .limit(1);
    if (!run) throw new Error("助手协作运行链不完整");
    chain.push(run);
    if (!["agent_call", "handoff"].includes(run.sourceType)) break;
    currentRunId = parseCollaborationParentId(run);
    if (!currentRunId) throw new Error("助手协作运行来源不正确");
  }

  return chain;
}
