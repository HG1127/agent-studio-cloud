export const WORKFLOW_NODE_FOCUS_EVENT = "agent-studio:workflow-node-focus";

export interface WorkflowNodeFocusDetail {
  agentId: string;
  nodeId: string;
}

export function requestWorkflowNodeFocus(detail: WorkflowNodeFocusDetail) {
  window.dispatchEvent(new CustomEvent<WorkflowNodeFocusDetail>(WORKFLOW_NODE_FOCUS_EVENT, { detail }));
}
