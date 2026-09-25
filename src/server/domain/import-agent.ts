import { AgentImportFile } from "@/contracts/agent";
import type { WorkflowDraft } from "@/contracts/workflow";
import { bindWorkflowRootAgent } from "@/server/domain/workflow-root-agent";

export const MAX_AGENT_IMPORT_BYTES = 5 * 1024 * 1024;

export function agentImportSizeIssue(input: unknown): string | null {
  try {
    const serialized = JSON.stringify(input);
    if (serialized === undefined) return "导入内容不是有效的 JSON";
    return new TextEncoder().encode(serialized).byteLength > MAX_AGENT_IMPORT_BYTES
      ? "导入文件不能超过 5MB"
      : null;
  } catch {
    return "导入内容不是有效的 JSON";
  }
}

export interface NormalizedAgentImport {
  name: string;
  description: string | null;
  intentText: string;
  workflow: WorkflowDraft;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nestedSteps(node: Record<string, unknown>): Record<string, unknown>[] {
  const subflow = isRecord(node.subflow) ? node.subflow : null;
  const parallel = isRecord(node.parallel) ? node.parallel : null;
  const subflowSteps = Array.isArray(subflow?.steps) ? subflow.steps.filter(isRecord) : [];
  const parallelSteps = Array.isArray(parallel?.branches)
    ? parallel.branches.flatMap((branch) => isRecord(branch) && Array.isArray(branch.steps) ? branch.steps.filter(isRecord) : [])
    : [];
  return [...subflowSteps, ...parallelSteps];
}

function collectCollaborationKeys(node: Record<string, unknown>, keys: Set<string>) {
  if (node.type === "agent_call" && isRecord(node.agentCall)) {
    const targetAgentId = node.agentCall.targetAgentId;
    const versionId = node.agentCall.versionId;
    if (typeof targetAgentId === "string" && targetAgentId && typeof versionId === "string" && versionId) {
      keys.add(`${targetAgentId}:${versionId}`);
    }
  }
  if (node.type === "handoff" && isRecord(node.toAgent)) {
    const targetAgentId = node.toAgent.id;
    const versionId = node.toAgent.versionId;
    if (typeof targetAgentId === "string" && targetAgentId && typeof versionId === "string" && versionId) {
      keys.add(`${targetAgentId}:${versionId}`);
    }
  }
  for (const step of nestedSteps(node)) collectCollaborationKeys(step, keys);
}

export function importedCollaborationKeys(workflow: WorkflowDraft) {
  const keys = new Set<string>();
  for (const node of Object.values(workflow.nodes)) collectCollaborationKeys(node, keys);
  return [...keys];
}

function rebindNode(node: Record<string, unknown>, validKeys: ReadonlySet<string>): Record<string, unknown> {
  const rebound = { ...node };
  if (node.type === "agent_call" && isRecord(node.agentCall)) {
    const key = `${node.agentCall.targetAgentId ?? ""}:${node.agentCall.versionId ?? ""}`;
    if (!validKeys.has(key)) rebound.agentCall = { targetAgentId: "", versionId: "" };
  }
  if (node.type === "handoff" && isRecord(node.toAgent)) {
    const key = `${node.toAgent.id ?? ""}:${node.toAgent.versionId ?? ""}`;
    if (!validKeys.has(key)) {
      rebound.toAgent = { id: "", versionId: "" };
      rebound.contract = undefined;
    }
  }

  if (isRecord(node.subflow) && Array.isArray(node.subflow.steps)) {
    rebound.subflow = {
      ...node.subflow,
      steps: node.subflow.steps.map((step) => isRecord(step) ? rebindNode(step, validKeys) : step),
    };
  }
  if (isRecord(node.parallel) && Array.isArray(node.parallel.branches)) {
    rebound.parallel = {
      ...node.parallel,
      branches: node.parallel.branches.map((branch) => isRecord(branch) && Array.isArray(branch.steps)
        ? { ...branch, steps: branch.steps.map((step) => isRecord(step) ? rebindNode(step, validKeys) : step) }
        : branch),
    };
  }
  return rebound;
}

export function rebindImportedWorkflow(args: {
  workflow: WorkflowDraft;
  agentId: string;
  agentName: string;
  validCollaborationKeys: ReadonlySet<string>;
}): WorkflowDraft {
  const nodes = Object.fromEntries(Object.entries(args.workflow.nodes).map(
    ([id, node]) => [id, rebindNode(node, args.validCollaborationKeys)],
  )) as WorkflowDraft["nodes"];
  return bindWorkflowRootAgent({
    ...args.workflow,
    versionId: null,
    nodes,
  }, { id: args.agentId, name: args.agentName });
}

export function normalizeAgentImport(input: unknown): NormalizedAgentImport | null {
  if (agentImportSizeIssue(input)) return null;
  const parsed = AgentImportFile.safeParse(input);
  if (!parsed.success) return null;
  if (parsed.data.format === "agent-studio-cloud") {
    return {
      name: parsed.data.agent.name,
      description: parsed.data.agent.description,
      intentText: parsed.data.agent.intentText,
      workflow: parsed.data.workflow,
    };
  }
  const version = parsed.data.version.number;
  return {
    name: parsed.data.agent.name,
    description: `从冻结版本 ${version} 导入的可编辑副本`,
    intentText: `从冻结版本 ${version} 导入，保留当时的流程、运行输入和最终交付。`,
    workflow: {
      ...parsed.data.manifest.workflowSnapshot,
      versionId: null,
      rootAgent: { ...parsed.data.manifest.workflowSnapshot.rootAgent, name: parsed.data.agent.name },
    },
  };
}
