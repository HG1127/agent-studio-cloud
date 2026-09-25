import { getRun } from "workflow/api";
import { WorkflowRunNotFoundError } from "workflow/errors";

export async function cancelWorkflowRunIfPresent(workflowRunId: string): Promise<"cancelled" | "missing"> {
  try {
    await getRun(workflowRunId).cancel();
    return "cancelled";
  } catch (error) {
    if (WorkflowRunNotFoundError.is(error)) return "missing";
    throw error;
  }
}
