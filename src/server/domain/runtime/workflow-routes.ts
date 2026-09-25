import type { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { isSafeDataPathSegment } from "@/server/domain/runtime/data-path";

type RouteRef = { target: string | null | undefined; label: string };

function nodeRoutes(node: WorkflowNode): RouteRef[] {
  const routes: RouteRef[] = [
    { target: node.next, label: "正常路径" },
    { target: node.rejectNext, label: "未通过路径" },
    { target: node.onErrorNext, label: "未完成路径" },
  ];
  if (node.type === "condition") {
    node.condition?.branches.forEach((branch, index) => routes.push({
      target: branch.next,
      label: `情况“${branch.label || index + 1}”`,
    }));
    routes.push({ target: node.condition?.defaultNext, label: "其余情况路径" });
  }
  if (node.type === "loop") {
    routes.push({ target: node.loop?.bodyNext, label: "逐项处理路径" });
    routes.push({ target: node.loop?.exitNext, label: "循环完成路径" });
  }
  if (node.type === "wait") {
    routes.push({ target: node.wait?.onTimeoutNext, label: "等待超时路径" });
  }
  return routes;
}

export function validateWorkflowRoutes(draft: Pick<WorkflowDraft, "startNodeId" | "nodes">): string | null {
  const nodes = draft.nodes;
  const hasNode = (nodeId: string) => Object.prototype.hasOwnProperty.call(nodes, nodeId);
  const start = hasNode(draft.startNodeId) ? nodes[draft.startNodeId] : undefined;
  if (!start) return "流程的启动步骤不存在，请重新连接后保存";
  if (start.type !== "trigger") return "流程必须从启动步骤开始";

  for (const [nodeKey, node] of Object.entries(nodes)) {
    if (!node.id.trim() || node.id !== nodeKey) return `步骤“${node.title || nodeKey}”的标识与画布记录不一致`;
    if (nodeKey.length > 200 || !/^[A-Za-z0-9_-]+$/.test(nodeKey) || !isSafeDataPathSegment(nodeKey)) {
      return `步骤“${node.title || nodeKey}”的标识包含不安全字符`;
    }
    for (const route of nodeRoutes(node)) {
      if (route.target && !hasNode(route.target)) return `步骤“${node.title}”的${route.label}指向了不存在的步骤`;
    }
    if (node.type === "human" && !node.rejectNext && !hasNode("not_approved")) {
      return `员工确认步骤“${node.title}”缺少未通过后的安全处理路径`;
    }
  }
  return null;
}
