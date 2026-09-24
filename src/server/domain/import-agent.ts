import { AgentImportFile } from "@/contracts/agent";
import type { WorkflowDraft } from "@/contracts/workflow";

export interface NormalizedAgentImport {
  name: string;
  description: string | null;
  intentText: string;
  workflow: WorkflowDraft;
}

export function importedCollaborationKeys(workflow: WorkflowDraft) {
  return [...new Set(Object.values(workflow.nodes).flatMap((node) => {
    if (node.type === "agent_call" && node.agentCall?.targetAgentId && node.agentCall.versionId) {
      return [`${node.agentCall.targetAgentId}:${node.agentCall.versionId}`];
    }
    if (node.type === "handoff" && node.toAgent?.id && node.toAgent.versionId) {
      return [`${node.toAgent.id}:${node.toAgent.versionId}`];
    }
    return [];
  }))];
}

export function rebindImportedWorkflow(args: {
  workflow: WorkflowDraft;
  agentId: string;
  agentName: string;
  validCollaborationKeys: ReadonlySet<string>;
}): WorkflowDraft {
  const nodes = Object.fromEntries(Object.entries(args.workflow.nodes).map(([id, node]) => {
    if (node.type === "agent_call" && node.agentCall) {
      const key = `${node.agentCall.targetAgentId}:${node.agentCall.versionId}`;
      if (!args.validCollaborationKeys.has(key)) {
        return [id, { ...node, agentCall: { targetAgentId: "", versionId: "" } }];
      }
    }
    if (node.type === "handoff" && node.toAgent) {
      const key = `${node.toAgent.id}:${node.toAgent.versionId ?? ""}`;
      if (!args.validCollaborationKeys.has(key)) {
        return [id, { ...node, toAgent: { id: "", versionId: "" }, contract: undefined }];
      }
    }
    return [id, node];
  }));
  return {
    ...args.workflow,
    versionId: null,
    rootAgent: { ...args.workflow.rootAgent, id: args.agentId, name: args.agentName },
    nodes,
  };
}

export function normalizeAgentImport(input: unknown): NormalizedAgentImport | null {
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
