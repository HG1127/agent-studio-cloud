import type { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { isHiddenControlNode } from "@/lib/workflow-node-visibility";
import { outgoingSpecs, visibleOutgoingSpecs } from "./flow-edges";

export interface WorkflowStepRoute {
  targetId: string;
  targetTitle: string | null;
  label: string;
  collapsed: boolean;
}

export interface WorkflowStepGuideEntry {
  node: WorkflowNode;
  reachable: boolean;
  routes: WorkflowStepRoute[];
  hasHiddenContinuation: boolean;
}

function defaultRouteLabel(node: WorkflowNode): string {
  if (node.type === "wait") return "等待完成后";
  if (node.type === "parallel") return "各项完成后";
  return "完成后";
}

export function workflowStepGuide(draft: WorkflowDraft, showControlNodes: boolean): WorkflowStepGuideEntry[] {
  const visibleIds = new Set(Object.values(draft.nodes)
    .filter((node) => showControlNodes || !isHiddenControlNode(node))
    .map((node) => node.id));
  const order: string[] = [];
  const reachable = new Set<string>();
  const queue = [draft.startNodeId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (reachable.has(id) || !draft.nodes[id]) continue;
    reachable.add(id);
    order.push(id);
    for (const spec of outgoingSpecs(draft.nodes[id])) queue.push(spec.target);
  }
  for (const id of Object.keys(draft.nodes)) {
    if (!reachable.has(id)) order.push(id);
  }

  return order.filter((id) => visibleIds.has(id)).map((id) => {
    const node = draft.nodes[id];
    const direct = outgoingSpecs(node);
    const specs = showControlNodes
      ? direct.map((spec) => ({ ...spec, collapsed: false }))
      : visibleOutgoingSpecs(node, draft.nodes, visibleIds);
    const routes: WorkflowStepRoute[] = specs.map((spec) => ({
      targetId: spec.target,
      targetTitle: draft.nodes[spec.target]?.title ?? null,
      label: spec.label ?? defaultRouteLabel(node),
      collapsed: spec.collapsed,
    }));
    for (const spec of direct) {
      if (!showControlNodes && !draft.nodes[spec.target]) routes.push({
        targetId: spec.target,
        targetTitle: null,
        label: spec.label ?? defaultRouteLabel(node),
        collapsed: false,
      });
    }
    return {
      node,
      reachable: reachable.has(id),
      routes,
      hasHiddenContinuation: !showControlNodes && direct.some((spec) => isHiddenControlNode(draft.nodes[spec.target])),
    };
  });
}
