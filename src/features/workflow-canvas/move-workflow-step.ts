import type { WorkflowDraft } from "@/contracts/workflow";
import { isHiddenControlNode } from "@/lib/workflow-node-visibility";
import { outgoingSpecs } from "./flow-edges";
import { autoLayout } from "./layout";

export type MoveDirection = "up" | "down";

const MOVE_ERROR = "只有同一条单一路径上的相邻普通步骤可以换序；请在流程线中调整分支或控制检查";

function incomingRoutes(draft: WorkflowDraft, targetId: string) {
  return Object.values(draft.nodes).flatMap((node) => outgoingSpecs(node)
    .filter((route) => route.target === targetId)
    .map((route) => ({ sourceId: node.id, handle: route.handle })));
}

function movePlan(draft: WorkflowDraft, nodeId: string, direction: MoveDirection):
  | { beforeId: string; firstId: string; secondId: string }
  | { error: string } {
  const selected = draft.nodes[nodeId];
  if (!selected) return { error: "找不到这个步骤，请重新选择" };
  const secondId = direction === "up" ? nodeId : selected.next;
  const firstId = direction === "up" ? incomingRoutes(draft, nodeId)[0]?.sourceId : nodeId;
  if (!firstId || !secondId) return { error: MOVE_ERROR };
  const first = draft.nodes[firstId];
  const second = draft.nodes[secondId];
  if (!first || !second || [first, second].some((node) =>
    ["trigger", "end", "condition", "loop"].includes(node.type) || isHiddenControlNode(node))) return { error: MOVE_ERROR };
  if (first.next !== second.id || second.next === first.id || !second.next || !draft.nodes[second.next]) return { error: MOVE_ERROR };
  const firstRoutes = outgoingSpecs(first);
  const secondRoutes = outgoingSpecs(second);
  const secondIncoming = incomingRoutes(draft, second.id);
  const firstIncoming = incomingRoutes(draft, first.id);
  if (firstRoutes.length !== 1 || firstRoutes[0].handle !== "next" || secondRoutes.length !== 1 || secondRoutes[0].handle !== "next"
    || secondIncoming.length !== 1 || secondIncoming[0].sourceId !== first.id || secondIncoming[0].handle !== "next"
    || firstIncoming.length !== 1 || firstIncoming[0].handle !== "next") return { error: MOVE_ERROR };
  const before = draft.nodes[firstIncoming[0].sourceId];
  if (!before || before.next !== first.id || outgoingSpecs(before).length !== 1) return { error: MOVE_ERROR };
  return { beforeId: before.id, firstId: first.id, secondId: second.id };
}

export function canMoveLinearStep(draft: WorkflowDraft, nodeId: string, direction: MoveDirection): boolean {
  return !("error" in movePlan(draft, nodeId, direction));
}

export function moveLinearStep(draft: WorkflowDraft, nodeId: string, direction: MoveDirection):
  | { draft: WorkflowDraft }
  | { error: string } {
  const plan = movePlan(draft, nodeId, direction);
  if ("error" in plan) return plan;
  const { beforeId, firstId, secondId } = plan;
  const before = draft.nodes[beforeId];
  const first = draft.nodes[firstId];
  const second = draft.nodes[secondId];
  const fallback = autoLayout(draft);
  const positions = { ...draft.ui.positions };
  positions[firstId] = draft.ui.positions[secondId] ?? fallback[secondId];
  positions[secondId] = draft.ui.positions[firstId] ?? fallback[firstId];
  return {
    draft: {
      ...draft,
      nodes: {
        ...draft.nodes,
        [beforeId]: { ...before, next: secondId },
        [firstId]: { ...first, next: second.next },
        [secondId]: { ...second, next: firstId },
      },
      ui: { ...draft.ui, positions },
    },
  };
}
