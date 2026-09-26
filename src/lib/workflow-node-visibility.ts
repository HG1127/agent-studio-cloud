export interface WorkflowNodeVisibility {
  ui?: { visibility?: unknown } | null;
  controlPlane?: { hiddenByDefault?: unknown } | null;
}

export function isHiddenControlNode(node: WorkflowNodeVisibility | null | undefined): boolean {
  return node?.ui?.visibility === "control" || node?.controlPlane?.hiddenByDefault === true;
}
