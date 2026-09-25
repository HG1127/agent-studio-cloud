import type { WorkflowNode } from "@/contracts/workflow";

function hasOwnOutput(outputs: Record<string, unknown>, nodeId: string): boolean {
  return Object.prototype.hasOwnProperty.call(outputs, nodeId);
}

function receiptSucceeded(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (value as Record<string, unknown>).ok === true;
}

export function missingExecutedToolReceipts(
  nodes: Record<string, WorkflowNode>,
  outputs: Record<string, unknown>,
): string[] {
  return Object.values(nodes)
    .filter((node) => node.type === "tool" && hasOwnOutput(outputs, node.id) && !receiptSucceeded(outputs[node.id]))
    .map((node) => node.title);
}

export function hasExecutedHumanStep(
  nodes: Record<string, WorkflowNode>,
  outputs: Record<string, unknown>,
): boolean {
  return Object.values(nodes).some((node) => node.type === "human" && hasOwnOutput(outputs, node.id));
}
