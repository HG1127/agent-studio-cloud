import type { WorkflowNode } from "@/contracts/workflow";

export function recordedBusinessObjective(node: WorkflowNode): string | null {
  const value = node.businessSpec?.objective;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
