import type { WorkflowDraft } from "@/contracts/workflow";
import { visibleOutgoingSpecs } from "./flow-edges";

export interface LayoutPosition {
  x: number;
  y: number;
}

export const LAYOUT_ORIGIN_X = 48;
export const LAYOUT_ORIGIN_Y = 48;
export const LAYOUT_COLUMN_GAP = 300;
export const LAYOUT_ROW_GAP = 130;

// 沿契约的全部出边收集后继（loop 出边供分层，wait 超时边不在 M1 画布语义内）
function successorIds(draft: WorkflowDraft, id: string, includedIds?: ReadonlySet<string>): string[] {
  const node = draft.nodes[id];
  if (!node) return [];
  if (includedIds) {
    return [...new Set(visibleOutgoingSpecs(node, draft.nodes, includedIds).map((edge) => edge.target))];
  }
  const targets: Array<string | null | undefined> = [
    node.next,
    node.rejectNext,
    node.onErrorNext,
    ...(node.condition?.branches.map((branch) => branch.next) ?? []),
    node.condition?.defaultNext,
    node.loop?.bodyNext,
    node.loop?.exitNext,
  ];
  const seen = new Set<string>();
  for (const target of targets) {
    if (target && target !== id && draft.nodes[target]) seen.add(target);
  }
  return [...seen];
}

// Kosaraju 强连通分量：环内节点收敛为同一分量，之后按分量做无环分层
function stronglyConnectedComponents(ids: string[], successors: Map<string, string[]>): string[][] {
  const idSet = new Set(ids);
  const reverse = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const id of ids) {
    for (const next of successors.get(id) ?? []) {
      if (idSet.has(next)) reverse.get(next)!.push(id);
    }
  }
  const visited = new Set<string>();
  const finishOrder: string[] = [];
  for (const root of ids) {
    if (visited.has(root)) continue;
    const stack: Array<{ id: string; index: number }> = [{ id: root, index: 0 }];
    visited.add(root);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const nextIds = successors.get(frame.id) ?? [];
      if (frame.index < nextIds.length) {
        const next = nextIds[frame.index++];
        if (!visited.has(next)) {
          visited.add(next);
          stack.push({ id: next, index: 0 });
        }
      } else {
        finishOrder.push(frame.id);
        stack.pop();
      }
    }
  }
  const componentOf = new Map<string, number>();
  const components: string[][] = [];
  for (let i = finishOrder.length - 1; i >= 0; i--) {
    const root = finishOrder[i];
    if (componentOf.has(root)) continue;
    const component: string[] = [];
    const stack = [root];
    componentOf.set(root, components.length);
    while (stack.length > 0) {
      const id = stack.pop()!;
      component.push(id);
      for (const prev of reverse.get(id) ?? []) {
        if (!componentOf.has(prev)) {
          componentOf.set(prev, components.length);
          stack.push(prev);
        }
      }
    }
    components.push(component);
  }
  return components;
}

// 从起点所在分量沿分量出边做 BFS 放松分层（等价最长路径，保证后继不会排到前驱同层或更前）；
// 从起点不可达的分量统一排在最后一层之后，保证每个节点都有位置
function assignComponentLevels(
  components: string[][],
  componentOf: Map<string, number>,
  componentSuccessors: Map<number, number[]>,
  startComponent: number,
): Map<number, number> {
  const levels = new Map<number, number>([[startComponent, 0]]);
  const queue: number[] = [startComponent];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of componentSuccessors.get(current) ?? []) {
      if ((levels.get(next) ?? -1) < levels.get(current)! + 1) {
        levels.set(next, levels.get(current)! + 1);
        queue.push(next);
      }
    }
  }
  const maxLevel = Math.max(0, ...levels.values());
  components.forEach((_, index) => {
    if (!levels.has(index)) levels.set(index, maxLevel + 1);
  });
  return levels;
}

export function autoLayout(draft: WorkflowDraft, includedIds?: ReadonlySet<string>): Record<string, LayoutPosition> {
  const ids = Object.keys(draft.nodes).filter((id) => !includedIds || includedIds.has(id));
  if (ids.length === 0) return {};
  const successors = new Map<string, string[]>(ids.map((id) => [id, successorIds(draft, id, includedIds)]));
  const components = stronglyConnectedComponents(ids, successors);
  const componentOf = new Map<string, number>();
  components.forEach((component, index) => {
    for (const id of component) componentOf.set(id, index);
  });
  const componentSuccessors = new Map<number, number[]>();
  const componentSuccessorSets = new Map<number, Set<number>>();
  for (const id of ids) {
    const from = componentOf.get(id)!;
    let ordered = componentSuccessors.get(from);
    let seen = componentSuccessorSets.get(from);
    if (!ordered || !seen) {
      ordered = ordered ?? [];
      seen = seen ?? new Set<number>();
      componentSuccessors.set(from, ordered);
      componentSuccessorSets.set(from, seen);
    }
    for (const next of successors.get(id) ?? []) {
      const to = componentOf.get(next)!;
      if (to !== from && !seen.has(to)) {
        seen.add(to);
        ordered.push(to);
      }
    }
  }
  const startId = draft.nodes[draft.startNodeId] ? draft.startNodeId : ids[0];
  const levels = assignComponentLevels(components, componentOf, componentSuccessors, componentOf.get(startId)!);

  const layerBuckets = new Map<number, string[]>();
  for (const id of ids) {
    const level = levels.get(componentOf.get(id)!)!;
    const bucket = layerBuckets.get(level) ?? [];
    bucket.push(id);
    layerBuckets.set(level, bucket);
  }
  const positions: Record<string, LayoutPosition> = {};
  for (const [level, bucket] of [...layerBuckets.entries()].sort((a, b) => a[0] - b[0])) {
    bucket.forEach((id, index) => {
      positions[id] = {
        x: LAYOUT_ORIGIN_X + level * LAYOUT_COLUMN_GAP,
        y: LAYOUT_ORIGIN_Y + index * LAYOUT_ROW_GAP,
      };
    });
  }
  return positions;
}
