import type { ApprovalReview } from "@/contracts/run";
import type { WorkflowNode } from "@/contracts/workflow";

export function selectApprovalReview(
  outputs: Record<string, unknown>,
  nodes: Record<string, WorkflowNode>,
): ApprovalReview | null {
  for (const [nodeId, output] of Object.entries(outputs).reverse()) {
    const node = nodes[nodeId];
    if (node?.type !== "ai" || typeof output !== "string" || !output.trim()) continue;
    return { sourceNodeId: nodeId, sourceTitle: node.title, content: output };
  }
  return null;
}
