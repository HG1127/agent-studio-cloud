import { AgentImportFile } from "@/contracts/agent";
import type { WorkflowDraft } from "@/contracts/workflow";

export interface NormalizedAgentImport {
  name: string;
  description: string | null;
  intentText: string;
  workflow: WorkflowDraft;
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
