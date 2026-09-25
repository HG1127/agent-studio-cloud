import type { Connection } from "@xyflow/react";
import type { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { updateWorkflowNode } from "./update-workflow-node";

export type EdgeKind = "next" | "reject" | "error" | "branch" | "body" | "timeout";

export interface EdgeSpec {
  handle: string;
  target: string;
  kind: EdgeKind;
  label?: string;
}

const ERROR_ROUTE_TYPES = new Set([
  "ai", "tool", "knowledge", "condition", "system", "rule", "loop", "memory",
  "agent_call", "handoff", "parallel", "subflow",
]);

export function supportsErrorRoute(node: Pick<WorkflowNode, "type">) {
  return ERROR_ROUTE_TYPES.has(node.type);
}

export function outgoingSpecs(node: WorkflowNode): EdgeSpec[] {
  const specs: EdgeSpec[] = [];
  if (node.rejectNext) specs.push({ handle: "reject", target: node.rejectNext, kind: "reject", label: "不通过" });
  if (node.onErrorNext) specs.push({ handle: "error", target: node.onErrorNext, kind: "error", label: "未完成时" });
  if (node.type === "condition") {
    node.condition?.branches.forEach((branch, index) => {
      if (branch.next) specs.push({ handle: `branch-${index}`, target: branch.next, kind: "branch", label: branch.label || "满足" });
    });
    if (node.condition?.defaultNext) specs.push({ handle: "default", target: node.condition.defaultNext, kind: "branch", label: "否则" });
  }
  if (node.type === "loop") {
    if (node.loop?.bodyNext) specs.push({ handle: "body", target: node.loop.bodyNext, kind: "body", label: "逐项处理" });
    if (node.loop?.exitNext) specs.push({ handle: "exit", target: node.loop.exitNext, kind: "next", label: "完成" });
  }
  if (node.type === "wait" && node.wait?.onTimeoutNext) {
    specs.push({ handle: "timeout", target: node.wait.onTimeoutNext, kind: "timeout", label: "超时" });
  }
  if (node.next) specs.push({ handle: "next", target: node.next, kind: "next" });
  return specs;
}

function patchNode(draft: WorkflowDraft, nodeId: string, node: WorkflowNode): WorkflowDraft {
  return updateWorkflowNode(draft, nodeId, node);
}

export function removeNode(draft: WorkflowDraft, nodeId: string): WorkflowDraft {
  const target = draft.nodes[nodeId];
  if (!target || target.type === "trigger" || target.type === "end" || draft.startNodeId === nodeId) return draft;
  const nodes: Record<string, WorkflowNode> = {};
  for (const [id, node] of Object.entries(draft.nodes)) {
    if (id === nodeId) continue;
    const cleaned: WorkflowNode = {
      ...node,
      next: node.next === nodeId ? null : node.next,
      rejectNext: node.rejectNext === nodeId ? null : node.rejectNext,
      onErrorNext: node.onErrorNext === nodeId ? null : node.onErrorNext,
    };
    if (node.condition) {
      cleaned.condition = {
        ...node.condition,
        branches: node.condition.branches.map((branch) => branch.next === nodeId ? { ...branch, next: null } : branch),
        defaultNext: node.condition.defaultNext === nodeId ? null : node.condition.defaultNext,
      };
    }
    if (node.loop) {
      cleaned.loop = {
        ...node.loop,
        bodyNext: node.loop.bodyNext === nodeId ? null : node.loop.bodyNext,
        exitNext: node.loop.exitNext === nodeId ? null : node.loop.exitNext,
      };
    }
    if (node.wait) {
      cleaned.wait = { ...node.wait, onTimeoutNext: node.wait.onTimeoutNext === nodeId ? null : node.wait.onTimeoutNext };
    }
    nodes[id] = cleaned;
  }
  const positions = { ...draft.ui.positions };
  delete positions[nodeId];
  return { ...draft, nodes, ui: { ...draft.ui, positions } };
}

export function applyConnection(draft: WorkflowDraft, connection: Connection): WorkflowDraft {
  const { source, target, sourceHandle } = connection;
  if (!source || !target || source === target || !draft.nodes[source] || !draft.nodes[target]) return draft;
  const node = draft.nodes[source];
  if (sourceHandle === "reject") return patchNode(draft, source, { ...node, rejectNext: target });
  if (sourceHandle === "error") return patchNode(draft, source, { ...node, onErrorNext: target });
  if (sourceHandle === "timeout" && node.wait) return patchNode(draft, source, { ...node, wait: { ...node.wait, onTimeoutNext: target } });
  if (sourceHandle === "default") {
    const condition = node.condition ?? { source: null, operator: "eq" as const, branches: [], defaultNext: null };
    return patchNode(draft, source, { ...node, condition: { ...condition, defaultNext: target } });
  }
  if (sourceHandle === "body" || sourceHandle === "exit") {
    if (!node.loop) return draft;
    const loop = { ...node.loop };
    if (sourceHandle === "body") loop.bodyNext = target;
    else loop.exitNext = target;
    return patchNode(draft, source, { ...node, loop });
  }
  if (sourceHandle?.startsWith("branch-")) {
    if (!node.condition) return draft;
    const index = Number(sourceHandle.slice("branch-".length));
    if (!Number.isInteger(index) || index < 0 || index >= node.condition.branches.length) return draft;
    return patchNode(draft, source, {
      ...node,
      condition: {
        ...node.condition,
        branches: node.condition.branches.map((branch, branchIndex) => branchIndex === index ? { ...branch, next: target } : branch),
      },
    });
  }
  return patchNode(draft, source, { ...node, next: target });
}

export function clearEdge(draft: WorkflowDraft, edgeId: string): WorkflowDraft {
  const parts = edgeId.split("~");
  if (parts.length !== 3) return draft;
  const [source, handle, target] = parts;
  const node = draft.nodes[source];
  if (!node) return draft;
  if (handle === "reject") return node.rejectNext === target ? patchNode(draft, source, { ...node, rejectNext: null }) : draft;
  if (handle === "error") return node.onErrorNext === target ? patchNode(draft, source, { ...node, onErrorNext: null }) : draft;
  if (handle === "timeout" && node.wait) {
    return node.wait.onTimeoutNext === target ? patchNode(draft, source, { ...node, wait: { ...node.wait, onTimeoutNext: null } }) : draft;
  }
  if (handle === "default" && node.condition) {
    return node.condition.defaultNext === target ? patchNode(draft, source, { ...node, condition: { ...node.condition, defaultNext: null } }) : draft;
  }
  if ((handle === "body" || handle === "exit") && node.loop) {
    if (handle === "body" ? node.loop.bodyNext !== target : node.loop.exitNext !== target) return draft;
    const loop = { ...node.loop };
    if (handle === "body") loop.bodyNext = null;
    else loop.exitNext = null;
    return patchNode(draft, source, { ...node, loop });
  }
  if (handle.startsWith("branch-") && node.condition) {
    const index = Number(handle.slice("branch-".length));
    if (!Number.isInteger(index) || index < 0 || index >= node.condition.branches.length || node.condition.branches[index].next !== target) return draft;
    return patchNode(draft, source, {
      ...node,
      condition: {
        ...node.condition,
        branches: node.condition.branches.map((branch, branchIndex) => branchIndex === index ? { ...branch, next: null } : branch),
      },
    });
  }
  return node.next === target ? patchNode(draft, source, { ...node, next: null }) : draft;
}
