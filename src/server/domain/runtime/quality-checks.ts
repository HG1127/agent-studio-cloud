import type { WorkflowNode } from "@/contracts/workflow";
import { hasMeaningfulResult } from "@/server/domain/runtime/result-content";

function hasOwnOutput(outputs: Record<string, unknown>, nodeId: string): boolean {
  return Object.prototype.hasOwnProperty.call(outputs, nodeId);
}

function receiptSucceeded(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (value as Record<string, unknown>).ok === true;
}

const RESULT_NODE_TYPES: ReadonlySet<WorkflowNode["type"]> = new Set([
  "ai", "tool", "knowledge", "system", "subflow", "loop", "parallel", "agent_call", "handoff",
]);

export function qualityOutputReferenceIssue(
  nodes: Record<string, WorkflowNode>,
  requiredOutputTitles: string[],
): string | null {
  for (const title of [...new Set(requiredOutputTitles)]) {
    const matches = Object.values(nodes).filter((node) => node.title === title);
    if (matches.length === 0) return `交付检查引用的步骤「${title}」不存在`;
    if (matches.length > 1) return `交付检查引用的步骤名称「${title}」不唯一，请先修改重复名称`;
  }
  return null;
}

export function countMeaningfulQualityOutputs(
  nodes: Record<string, WorkflowNode>,
  outputs: Record<string, unknown>,
  requiredOutputTitles: string[],
): number {
  const candidates = requiredOutputTitles.length > 0
    ? requiredOutputTitles.flatMap((title) => {
        const node = Object.values(nodes).find((item) => item.title === title);
        return node ? [node] : [];
      })
    : Object.values(nodes).filter((node) => RESULT_NODE_TYPES.has(node.type) && node.ui?.visibility !== "control");
  const candidateIds = [...new Set(candidates.map((node) => node.id))];
  return candidateIds.filter((nodeId) => hasOwnOutput(outputs, nodeId) && hasMeaningfulResult(outputs[nodeId])).length;
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
