import { WorkflowOutputPreviewResult, type WorkflowOutputPreviewResult as WorkflowOutputPreviewResultType } from "@/contracts/workflow-output-preview";
import { resolveWorkflowOutputPreview } from "@/server/domain/runtime/workflow-output-preview";

export async function getWorkflowOutputPreview(raw: unknown): Promise<WorkflowOutputPreviewResultType> {
  return WorkflowOutputPreviewResult.parse(resolveWorkflowOutputPreview(raw));
}
