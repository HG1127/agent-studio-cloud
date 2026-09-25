import type { WorkflowNode } from "@/contracts/workflow";

function hasOwnOutput(outputs: Record<string, unknown>, nodeId: string): boolean {
  return Object.prototype.hasOwnProperty.call(outputs, nodeId);
}

function receiptSucceeded(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (value as Record<string, unknown>).ok === true;
}

export function hasMeaningfulOutput(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some(hasMeaningfulOutput);
  if (typeof value !== "object") return false;
  const object = value as Record<string, unknown>;
  if (object.ok === false || object.status === "failed") return false;
  return Object.values(object).some(hasMeaningfulOutput);
}

const RESULT_NODE_TYPES: ReadonlySet<WorkflowNode["type"]> = new Set([
  "ai", "tool", "knowledge", "system", "subflow", "loop", "parallel", "agent_call", "handoff",
]);

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
  return candidateIds.filter((nodeId) => hasOwnOutput(outputs, nodeId) && hasMeaningfulOutput(outputs[nodeId])).length;
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
