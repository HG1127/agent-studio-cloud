import type { WorkflowDraft } from "@/contracts/workflow";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function bindNodeAgent(node: Record<string, unknown>, agent: { id: string; name: string }): Record<string, unknown> {
  return {
    ...node,
    ...(isRecord(node.agent) ? { agent: { ...node.agent, id: agent.id, name: agent.name } } : {}),
  };
}

function bindTopLevelNodeAgent(node: Record<string, unknown>, agent: { id: string; name: string }): Record<string, unknown> {
  const rebound = bindNodeAgent(node, agent);
  if (isRecord(node.subflow) && Array.isArray(node.subflow.steps)) {
    rebound.subflow = {
      ...node.subflow,
      steps: node.subflow.steps.map((step) => isRecord(step) ? bindNodeAgent(step, agent) : step),
    };
  }
  if (isRecord(node.parallel) && Array.isArray(node.parallel.branches)) {
    rebound.parallel = {
      ...node.parallel,
      branches: node.parallel.branches.map((branch) => isRecord(branch) && Array.isArray(branch.steps)
        ? { ...branch, steps: branch.steps.map((step) => isRecord(step) ? bindNodeAgent(step, agent) : step) }
        : branch),
    };
  }
  return rebound;
}

export function bindWorkflowRootAgent(
  draft: WorkflowDraft,
  agent: { id: string; name: string },
): WorkflowDraft {
  return {
    ...draft,
    rootAgent: { ...draft.rootAgent, id: agent.id, name: agent.name },
    nodes: Object.fromEntries(Object.entries(draft.nodes).map(
      ([id, node]) => [id, bindTopLevelNodeAgent(node, agent)],
    )) as WorkflowDraft["nodes"],
  };
}
