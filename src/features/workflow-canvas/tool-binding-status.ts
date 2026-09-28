import type { ToolRegistryOption } from "@/contracts/tool-registry";
import type { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";

export type ToolBindingStatus = "unbound" | "unavailable" | "demo" | "selected";

export function toolBindingStatus(node: WorkflowNode, options: readonly ToolRegistryOption[]): ToolBindingStatus {
  const tool = node.tool;
  if (!tool) return "unbound";
  if (tool.unresolved === true) return tool.connector === "unbound" ? "unbound" : "unavailable";
  if (tool.registryToolId === "demo" || tool.protocol === "demo") return "demo";
  if (!tool.registryToolId) return "unbound";
  return options.some((option) => option.id === tool.registryToolId) ? "selected" : "unavailable";
}

export function canvasToolBindingSummary(draft: WorkflowDraft, options: readonly ToolRegistryOption[]) {
  const toolNodes = Object.values(draft.nodes).filter((node) => node.type === "tool");
  const byStatus = toolNodes.map((node) => ({ node, status: toolBindingStatus(node, options) }));
  return {
    total: toolNodes.length,
    selected: byStatus.filter(({ status }) => status === "selected").length,
    demo: byStatus.filter(({ status }) => status === "demo").length,
    unbound: byStatus.filter(({ status }) => status === "unbound").length,
    unavailable: byStatus.filter(({ status }) => status === "unavailable").length,
    firstAttentionId: byStatus.find(({ status }) => status === "unavailable")?.node.id
      ?? byStatus.find(({ status }) => status === "unbound")?.node.id
      ?? null,
  };
}
