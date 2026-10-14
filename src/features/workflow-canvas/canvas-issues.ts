import type { ToolRegistryOption } from "@/contracts/tool-registry";
import type { WorkflowDraft } from "@/contracts/workflow";
import { outgoingSpecs } from "./flow-edges";
import { canvasToolBindings } from "./tool-binding-status";
import { workflowStepGuide } from "./workflow-step-guide";

export interface CanvasIssue {
  nodeId: string;
  message: string;
}

export function canvasIssues(draft: WorkflowDraft, toolOptions: readonly ToolRegistryOption[]): CanvasIssue[] {
  const issues: CanvasIssue[] = [];
  const add = (nodeId: string, message: string) => issues.push({ nodeId, message });
  const bindings = canvasToolBindings(draft, toolOptions);

  for (const { node, reachable } of workflowStepGuide(draft, true)) {
    const routes = outgoingSpecs(node);
    if (!reachable) add(node.id, "未接入从开始步骤出发的路径");
    if (routes.some(({ target }) => !draft.nodes[target])) add(node.id, "连接的目标步骤已不存在");
    for (const binding of bindings.filter((binding) => binding.ownerId === node.id)) {
      const prefix = binding.nested ? `${binding.label}：` : "";
      if (binding.status === "unbound") add(node.id, `${prefix}需要选择业务工具`);
      if (binding.status === "unavailable") add(node.id, `${prefix}原业务工具当前不可用，请重新选择`);
      if (binding.status === "changed") add(node.id, `${prefix}业务工具配置已变化，请核对并重新绑定`);
    }
    if (node.type === "condition" && (!node.condition?.branches.length
      || node.condition.branches.some((branch) => !branch.next)
      || !node.condition.defaultNext)) {
      add(node.id, "请补齐各情况及其余情况的去向");
    }
    if (node.type === "loop" && (!node.loop?.bodyNext || !node.loop.exitNext)) {
      add(node.id, "请补齐逐项处理和全部完成后的去向");
    }
    if (node.type !== "end" && routes.length === 0 && node.type !== "condition" && node.type !== "loop") {
      add(node.id, "尚未连接后续步骤");
    }
  }

  return issues;
}
