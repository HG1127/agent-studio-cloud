import type { AgentManifest } from "@/contracts/manifest";
import type { WorkflowNode } from "@/contracts/workflow";
import { failRun } from "@/server/steps/run-state";
import { runKnowledgeStep } from "@/server/steps/knowledge-step";

export async function knowledgeProbeWorkflow(
  runId: string,
  node: WorkflowNode,
  manifest: AgentManifest,
  input: Record<string, unknown>,
) {
  "use workflow";
  try {
    return await runKnowledgeStep({ runId, node, manifest, input });
  } catch (err) {
    await failRun(runId, err instanceof Error ? err.message : String(err));
    throw err;
  }
}
