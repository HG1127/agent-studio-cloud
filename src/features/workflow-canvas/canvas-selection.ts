import type { NodeChange } from "@xyflow/react";
import type { WorkflowNode } from "@/contracts/workflow";

export function canvasSelectedId(currentId: string | null, changes: readonly NodeChange[], nodes: readonly WorkflowNode[]): string | null {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    if (typeof node.id === "string" && node.id.trim()) counts.set(node.id, (counts.get(node.id) ?? 0) + 1);
  }
  const exists = (id: string) => counts.get(id) === 1;
  const current = currentId !== null && exists(currentId) ? currentId : null;
  const selections = new Map<string, { selected: boolean; index: number }>();
  changes.forEach((change, index) => {
    if (change.type === "select" && typeof change.id === "string" && exists(change.id) && typeof change.selected === "boolean") {
      selections.set(change.id, { selected: change.selected, index });
    }
  });
  let primary: string | null = null;
  let latest = -1;
  for (const [id, selection] of selections) {
    if (selection.selected && selection.index > latest) {
      primary = id;
      latest = selection.index;
    }
  }
  return primary ?? (current !== null && selections.get(current)?.selected !== false ? current : null);
}
