import type { WorkflowDraft } from "@/contracts/workflow";
import { prepareParallelBranches } from "@/server/domain/runtime/parallel-runtime";
import { prepareSubflow } from "@/server/domain/runtime/subflow-runtime";
import { validateModelOutputConfiguration } from "@/server/domain/runtime/model-output";

export function validateInlineWorkflows(draft: WorkflowDraft): string | null {
  for (const node of Object.values(draft.nodes)) {
    const modelIssue = validateModelOutputConfiguration(node);
    if (modelIssue) return modelIssue;
    if (node.type === "parallel") {
      const prepared = prepareParallelBranches(node);
      if (!prepared.ok) return prepared.error;
      for (const branch of prepared.branches) for (const step of branch.steps) {
        const issue = validateModelOutputConfiguration(step);
        if (issue) return issue;
      }
    }
    if (node.type === "subflow") {
      const prepared = prepareSubflow(node);
      if (!prepared.ok) return prepared.error;
      for (const step of prepared.steps) {
        const issue = validateModelOutputConfiguration(step);
        if (issue) return issue;
      }
    }
  }
  return null;
}
