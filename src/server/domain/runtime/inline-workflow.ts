import type { WorkflowDraft } from "@/contracts/workflow";
import { prepareParallelBranches } from "@/server/domain/runtime/parallel-runtime";
import { prepareSubflow } from "@/server/domain/runtime/subflow-runtime";

export function validateInlineWorkflows(draft: WorkflowDraft): string | null {
  for (const node of Object.values(draft.nodes)) {
    if (node.type === "parallel") {
      const prepared = prepareParallelBranches(node);
      if (!prepared.ok) return prepared.error;
    }
    if (node.type === "subflow") {
      const prepared = prepareSubflow(node);
      if (!prepared.ok) return prepared.error;
    }
  }
  return null;
}
