import type { WorkflowNode } from "@/contracts/workflow";

export interface QualityRepairPlan {
  nodeId: string;
  nextRepairAttempt: number;
  maxAttempts: number;
}

export function selectQualityRepair(
  missingNodes: WorkflowNode[],
  repairAttempts: Record<string, number>,
): QualityRepairPlan | null {
  const node = missingNodes.find((item) => {
    if (item.type !== "ai") return false;
    const maxAttempts = item.retry?.maxAttempts ?? 2;
    return (repairAttempts[item.id] ?? 0) < Math.max(0, maxAttempts - 1);
  });
  if (!node) return null;
  const maxAttempts = node.retry?.maxAttempts ?? 2;
  return {
    nodeId: node.id,
    nextRepairAttempt: (repairAttempts[node.id] ?? 0) + 1,
    maxAttempts,
  };
}
