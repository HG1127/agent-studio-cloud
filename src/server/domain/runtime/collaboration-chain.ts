export const MAX_COLLABORATION_DEPTH = 5;

export type CollaborationRunRef = {
  runId: string;
  agentId: string;
  sourceType: string;
  sourceKey: string | null;
};

export function parseCollaborationParentId(run: Pick<CollaborationRunRef, "sourceType" | "sourceKey">) {
  if (!run.sourceKey || !["agent_call", "handoff"].includes(run.sourceType)) return null;
  return /^(?:agent-call|handoff):([0-9a-f-]{36}):/i.exec(run.sourceKey)?.[1] ?? null;
}

export function validateCollaborationTarget(chain: CollaborationRunRef[], targetAgentId: string) {
  if (chain.some((run) => run.agentId === targetAgentId)) return "会形成助手循环调用，已停止";
  if (chain.length > MAX_COLLABORATION_DEPTH) return `超过最多 ${MAX_COLLABORATION_DEPTH} 层的助手协作限制`;
  return null;
}
