import type { WorkflowNode } from "@/contracts/workflow";
import { hasMeaningfulResult } from "@/server/domain/runtime/result-content";

function hasOwnOutput(outputs: Record<string, unknown>, nodeId: string): boolean {
  return Object.prototype.hasOwnProperty.call(outputs, nodeId);
}

function receiptSucceeded(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (value as Record<string, unknown>).ok === true;
}

const RESULT_NODE_TYPES: ReadonlySet<string> = new Set([
  "ai", "tool", "knowledge", "system", "subflow", "loop", "parallel", "agent_call", "handoff",
]);

export function canProduceQualityResult(type: string | null | undefined): boolean {
  return typeof type === "string" && RESULT_NODE_TYPES.has(type);
}

export function qualityOutputReferenceIssue(
  nodes: Record<string, WorkflowNode>,
  requiredOutputTitles: string[],
  minOutputCount = 0,
): string | null {
  const uniqueTitles = [...new Set(requiredOutputTitles)];
  for (const title of uniqueTitles) {
    const matches = Object.values(nodes).filter((node) => node.title === title);
    if (matches.length === 0) return `交付检查引用的步骤「${title}」不存在`;
    if (matches.length > 1) return `交付检查引用的步骤名称「${title}」不唯一，请先修改重复名称`;
    if (!canProduceQualityResult(matches[0].type)) return `交付检查引用的步骤「${title}」不会产生可检查结果`;
  }
  if (uniqueTitles.length > 0 && minOutputCount > uniqueTitles.length) {
    return `交付检查要求至少 ${minOutputCount} 项结果，但只指定了 ${uniqueTitles.length} 个结果来源`;
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
    : Object.values(nodes).filter((node) => canProduceQualityResult(node.type) && node.ui?.visibility !== "control");
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
