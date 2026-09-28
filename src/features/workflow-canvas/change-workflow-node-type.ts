import { WorkflowNode, type WorkflowDraft } from "@/contracts/workflow";
import { isHiddenControlNode } from "@/lib/workflow-node-visibility";
import { ADDABLE_NODE_TYPES, createWorkflowNode } from "./create-workflow-node";
import { outgoingSpecs, supportsErrorRoute } from "./flow-edges";

export type ChangeableNodeType = (typeof ADDABLE_NODE_TYPES)[number];

export function changeWorkflowNodeType(draft: WorkflowDraft, nodeId: string, targetType: ChangeableNodeType):
  | { draft: WorkflowDraft; droppedRoutes: string[]; removedOutputFields: string[] }
  | { error: string } {
  const source = draft.nodes[nodeId];
  if (!source) return { error: "找不到这个步骤，请重新选择" };
  if (source.type === targetType) return { error: "这一步已经是所选处理类型" };
  if (source.type === "trigger" || source.type === "end" || isHiddenControlNode(source)) {
    return { error: "启动、完成和控制检查步骤不能更改处理类型" };
  }
  if (Object.values(draft.nodes).some((node) => isHiddenControlNode(node)
    && ((node.type === "rule" && node.rule?.sourceNodeId === nodeId)
      || (node.type === "human" && node.controlPlane?.kind === "governance" && node.next === nodeId)))) {
    return { error: "这一步关联了隐藏的控制检查，请先核对控制路径；不能直接更改类型" };
  }

  const primaryHandle = source.type === "condition" ? "default" : source.type === "loop" ? "exit" : "next";
  const primaryTarget = source.type === "condition"
    ? source.condition?.defaultNext ?? source.next
    : source.type === "loop" ? source.loop?.exitNext ?? source.next : source.next;
  const errorPreserved = supportsErrorRoute(source) && supportsErrorRoute({ type: targetType });
  const dropped = outgoingSpecs(source).filter((route) =>
    !(route.handle === primaryHandle && route.target === primaryTarget)
    && !(route.handle === "next" && primaryHandle !== "next" && route.target === primaryTarget)
    && !(route.handle === "error" && errorPreserved));
  if (dropped.some((route) => isHiddenControlNode(draft.nodes[route.target]))) {
    return { error: "有分支连接到隐藏的控制检查，请先核对控制路径；不能直接更改类型" };
  }
  const droppedRoutes = dropped.map((route) => route.label || (route.handle === "reject" ? "未通过时" : route.handle === "next" ? "完成后" : "其他路径"));

  const { nodeId: templateId, draft: withTemplate } = createWorkflowNode(draft, targetType);
  const template = withTemplate.nodes[templateId];
  const converted = WorkflowNode.parse({
    ...template,
    id: source.id,
    title: source.title,
    ...(source.description ? { description: source.description } : {}),
    ...(source.agent ? { agent: source.agent } : {}),
    requirementIds: source.requirementIds,
    businessSpec: null,
    next: targetType === "condition" || targetType === "loop" ? null : primaryTarget,
    onErrorNext: errorPreserved ? source.onErrorNext : null,
    ...(targetType === "condition" && template.condition ? { condition: { ...template.condition, defaultNext: primaryTarget } } : {}),
    ...(targetType === "loop" && template.loop ? { loop: { ...template.loop, exitNext: primaryTarget } } : {}),
  });
  const fields = draft.outputContract?.fields ?? [];
  const removedOutputFields = fields
    .filter((field) => (field.sourceNodeId ?? field.path.split(".")[0]) === nodeId)
    .map((field) => field.label || field.path);
  const outputFields = fields.filter((field) => (field.sourceNodeId ?? field.path.split(".")[0]) !== nodeId);
  return {
    draft: {
      ...draft,
      nodes: { ...draft.nodes, [nodeId]: converted },
      ...(draft.outputContract ? { outputContract: { fields: outputFields } } : {}),
    },
    droppedRoutes,
    removedOutputFields,
  };
}
