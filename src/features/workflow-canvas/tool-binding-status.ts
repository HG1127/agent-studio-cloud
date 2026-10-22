import type { ToolRegistryOption } from "@/contracts/tool-registry";
import { ToolSpec, type WorkflowDraft, type WorkflowNode } from "@/contracts/workflow";
import { canonicalJson } from "@/server/domain/canonical-json";

export type ToolBindingStatus = "unbound" | "unavailable" | "demo" | "changed" | "selected";

export function toolBindingChanges(tool: NonNullable<WorkflowNode["tool"]>, option: ToolRegistryOption): string[] {
  const changes: string[] = [];
  if (tool.action !== option.action) changes.push("执行动作");
  if (tool.scope !== option.scope) changes.push("权限范围");
  if (tool.risk !== option.risk) changes.push("风险级别");
  if ((tool.protocol ?? "http-json") !== (option.protocol ?? "http-json")) changes.push("连接方式");
  if (tool.operationKind !== option.operationKind) changes.push("读写约定");
  if (canonicalJson(tool.inputSchema) !== canonicalJson(option.inputSchema)) changes.push("输入约定");
  if (canonicalJson(tool.outputSchema) !== canonicalJson(option.outputSchema)) changes.push("返回约定");
  return changes;
}

export function toolBindingStatus(node: Pick<WorkflowNode, "tool">, options: readonly ToolRegistryOption[]): ToolBindingStatus {
  const tool = node.tool;
  if (!tool) return "unbound";
  if (tool.unresolved === true) return tool.connector === "unbound" ? "unbound" : "unavailable";
  if (tool.protocol === "demo") return "demo";
  if (!tool.registryToolId) return "unbound";
  const option = options.find((option) => option.id === tool.registryToolId);
  return !option ? "unavailable" : toolBindingChanges(tool, option).length ? "changed" : "selected";
}

export function canvasToolBindings(draft: WorkflowDraft, options: readonly ToolRegistryOption[]) {
  const bindings: { ownerId: string; label: string; nested: boolean; status: ToolBindingStatus }[] = [];
  for (const node of Object.values(draft.nodes)) {
    if (node.type === "tool") bindings.push({ ownerId: node.id, label: node.title, nested: false, status: toolBindingStatus(node, options) });
    const groups = node.type === "parallel" ? (node.parallel?.branches ?? []).map((branch) => ({ label: branch.label, steps: branch.steps }))
      : node.type === "subflow" && node.subflow ? [{ label: node.subflow.name, steps: node.subflow.steps }] : [];
    for (const group of groups) {
      for (const [index, step] of group.steps.entries()) {
        if (step.type !== "tool") continue;
        const parsed = ToolSpec.safeParse(step.tool);
        bindings.push({ ownerId: node.id, label: `${group.label || node.title} / ${typeof step.title === "string" && step.title ? step.title : `工具步骤 ${index + 1}`}`,
          nested: true, status: toolBindingStatus({ tool: parsed.success ? parsed.data : undefined }, options) });
      }
    }
  }
  return bindings;
}

export function canvasToolBindingSummary(draft: WorkflowDraft, options: readonly ToolRegistryOption[]) {
  const byStatus = canvasToolBindings(draft, options);
  return {
    total: byStatus.length,
    nested: byStatus.filter(({ nested }) => nested).length,
    selected: byStatus.filter(({ status }) => status === "selected").length,
    demo: byStatus.filter(({ status }) => status === "demo").length,
    unbound: byStatus.filter(({ status }) => status === "unbound").length,
    unavailable: byStatus.filter(({ status }) => status === "unavailable").length,
    changed: byStatus.filter(({ status }) => status === "changed").length,
    firstAttentionId: byStatus.find(({ status }) => status === "unavailable")?.ownerId
      ?? byStatus.find(({ status }) => status === "changed")?.ownerId
      ?? byStatus.find(({ status }) => status === "unbound")?.ownerId
      ?? null,
  };
}
