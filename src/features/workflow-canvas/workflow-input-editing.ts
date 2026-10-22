import { AgentInputField } from "@/contracts/manifest";
import type { WorkflowNode, WorkflowVariable } from "@/contracts/workflow";

export const INPUT_TYPE_LABELS = { string: "文字", number: "数字", boolean: "是或否", object: "对象", array: "列表" } satisfies Record<AgentInputField["type"], string>;

export function inputDefinitionIssue(variable: WorkflowVariable, variables: WorkflowVariable[]): string | null {
  if (!AgentInputField.shape.name.safeParse(variable.name).success) return "字段名不正确：请使用字母、数字和下划线，以字母或下划线开头，且不能使用保留名称。";
  if (variables.filter((item) => item.name === variable.name).length > 1) return "字段名重复；仅修改显示名称不能解决冲突，请核对字段名。";
  if (variable.scope === "run" && !AgentInputField.shape.type.safeParse(variable.type).success) return "原内容类型不能作为明确的运行输入，请选择支持的类型；选择前不会自动改写原类型。";
  return null;
}

export function moveInputDefinition(variables: WorkflowVariable[], index: number, delta: -1 | 1): WorkflowVariable[] {
  const target = index + delta;
  if (!Number.isInteger(index) || index < 0 || index >= variables.length || target < 0 || target >= variables.length) return variables;
  const next = [...variables];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function inputDefinitionReferences(name: string, nodes: Record<string, WorkflowNode>) {
  const references: Array<{ nodeId: WorkflowNode["id"]; title: WorkflowNode["title"]; kind: "条件来源" | "逐项处理来源" }> = [];
  const matches = (source: string | null | undefined, contextAlias = false) => {
    if (!source) return false;
    const [root, field] = source.split(".");
    if (root === "input" || root === "variables") return field === name;
    return contextAlias && root === "context" && field !== "outputs" && field !== "currentItem" && field === name;
  };
  for (const node of Object.values(nodes)) {
    if (node.type === "condition" && node.condition) {
      const direct = node.condition.branches.some((branch) => !branch.rules?.length) && matches(node.condition.source);
      const composite = node.condition.branches.some((branch) => branch.rules?.some((rule) => matches(rule.source)));
      if (direct || composite) references.push({ nodeId: node.id, title: node.title, kind: "条件来源" });
    }
    if (node.type === "loop" && matches(node.loop?.collectionPath, true)) references.push({ nodeId: node.id, title: node.title, kind: "逐项处理来源" });
  }
  return references;
}
