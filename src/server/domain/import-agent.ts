import { AgentImportFile } from "@/contracts/agent";
import type { AgentManifest } from "@/contracts/manifest";
import type { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { validateOutputContract } from "@/server/domain/runtime/output-contract";
import { validateWaitContracts } from "@/server/domain/runtime/wait-contract";
import { validateWorkflowRoutes } from "@/server/domain/runtime/workflow-routes";
import { validateInlineWorkflows } from "@/server/domain/runtime/inline-workflow";
import { bindWorkflowRootAgent } from "@/server/domain/workflow-root-agent";

export const MAX_AGENT_IMPORT_BYTES = 2 * 1024 * 1024;

export function agentImportSizeIssue(input: unknown): string | null {
  try {
    const serialized = JSON.stringify(input);
    if (serialized === undefined) return "导入内容不是有效的 JSON";
    return new TextEncoder().encode(serialized).byteLength > MAX_AGENT_IMPORT_BYTES
      ? "导入文件不能超过 2MB"
      : null;
  } catch {
    return "导入内容不是有效的 JSON";
  }
}

export function importedWorkflowIssue(workflow: WorkflowDraft): string | null {
  return validateWorkflowRoutes(workflow)
    ?? validateOutputContract(workflow.outputContract?.fields ?? [], workflow.nodes)
    ?? validateWaitContracts(workflow.nodes)
    ?? validateInlineWorkflows(workflow);
}

export interface NormalizedAgentImport {
  name: string;
  description: string | null;
  intentText: string;
  workflow: WorkflowDraft;
}

function editableWorkflowFromVersion(
  manifest: AgentManifest,
  agentName: string,
): WorkflowDraft {
  const workflow = manifest.workflowSnapshot;
  const nonRunVariables = workflow.variables.filter((variable) => variable.scope !== "run");
  const runVariables = manifest.inputContract.fields.map((field) => ({
    name: field.name,
    label: field.label,
    type: field.type,
    scope: "run",
    required: field.required,
  }));
  return {
    ...workflow,
    versionId: null,
    rootAgent: { ...workflow.rootAgent, name: agentName },
    variables: [...nonRunVariables, ...runVariables],
    outputContract: manifest.outputContract ?? workflow.outputContract,
  };
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

function collectCollaborationKey(node: Record<string, unknown>, keys: Set<string>) {
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
}

export function workflowCollaborationKeys(workflow: WorkflowDraft) {
  const keys = new Set<string>();
  for (const node of Object.values(workflow.nodes)) {
    collectCollaborationKey(node, keys);
    for (const step of nestedSteps(node)) collectCollaborationKey(step, keys);
  }
  return [...keys];
}

export const importedCollaborationKeys = workflowCollaborationKeys;

function rebindCollaborationNode(node: Record<string, unknown>, validKeys: ReadonlySet<string>): Record<string, unknown> {
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

  return rebound;
}

function rebindKnowledgeNode(node: Record<string, unknown>, validSourceIds: ReadonlySet<string>): Record<string, unknown> {
  if (node.type !== "knowledge" || !isRecord(node.knowledge) || !Array.isArray(node.knowledge.sourceIds)) return node;
  const requested = node.knowledge.sourceIds.filter((id): id is string => typeof id === "string");
  const sourceIds = requested.filter((id) => validSourceIds.has(id));
  return {
    ...node,
    knowledge: {
      ...node.knowledge,
      sourceIds,
      selectionRequired: requested.length !== sourceIds.length,
    },
  };
}

type ToolSnapshot = NonNullable<WorkflowNode["tool"]>;

function rebindToolNode(
  node: Record<string, unknown>,
  isToolBindingValid: (tool: ToolSnapshot) => boolean,
): Record<string, unknown> {
  if (node.type !== "tool" || !isRecord(node.tool)) return node;
  const tool = node.tool as ToolSnapshot;
  if (tool.registryToolId === "demo" || tool.protocol === "demo" || isToolBindingValid(tool)) return node;
  return {
    ...node,
    tool: { ...node.tool, registryToolId: null, protocol: "unbound", unresolved: true },
  };
}

function rebindPortableNode(
  node: Record<string, unknown>,
  validKeys: ReadonlySet<string>,
  validSourceIds: ReadonlySet<string>,
  isToolBindingValid: (tool: ToolSnapshot) => boolean,
): Record<string, unknown> {
  return rebindKnowledgeNode(rebindToolNode(rebindCollaborationNode(node, validKeys), isToolBindingValid), validSourceIds);
}

function rebindTopLevelNode(
  node: Record<string, unknown>,
  validKeys: ReadonlySet<string>,
  validSourceIds: ReadonlySet<string>,
  isToolBindingValid: (tool: ToolSnapshot) => boolean,
): Record<string, unknown> {
  const rebound = rebindPortableNode(node, validKeys, validSourceIds, isToolBindingValid);
  if (isRecord(node.subflow) && Array.isArray(node.subflow.steps)) {
    rebound.subflow = {
      ...node.subflow,
      steps: node.subflow.steps.map((step) => isRecord(step) ? rebindPortableNode(step, validKeys, validSourceIds, isToolBindingValid) : step),
    };
  }
  if (isRecord(node.parallel) && Array.isArray(node.parallel.branches)) {
    rebound.parallel = {
      ...node.parallel,
      branches: node.parallel.branches.map((branch) => isRecord(branch) && Array.isArray(branch.steps)
        ? { ...branch, steps: branch.steps.map((step) => isRecord(step) ? rebindPortableNode(step, validKeys, validSourceIds, isToolBindingValid) : step) }
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
  validKnowledgeSourceIds: ReadonlySet<string>;
  isToolBindingValid: (tool: ToolSnapshot) => boolean;
}): WorkflowDraft {
  const nodes = Object.fromEntries(Object.entries(args.workflow.nodes).map(
    ([id, node]) => [id, rebindTopLevelNode(
      node,
      args.validCollaborationKeys,
      args.validKnowledgeSourceIds,
      args.isToolBindingValid,
    )],
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
    workflow: editableWorkflowFromVersion(parsed.data.manifest, parsed.data.agent.name),
  };
}
