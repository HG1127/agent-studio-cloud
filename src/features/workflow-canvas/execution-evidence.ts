import { RunReportFile, RunSummary, type RunStepReport } from "@/contracts/run";
import type { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { WORKFLOW_NODE_FOCUS_EVENT, type WorkflowNodeFocusDetail } from "@/lib/workflow-node-focus";
import { redactSensitiveText } from "@/server/domain/security/redact-sensitive";

export function sameEvidenceUuid(left: string, right: string): boolean {
  return RunSummary.shape.id.safeParse(left).success && RunSummary.shape.id.safeParse(right).success && left.toLowerCase() === right.toLowerCase();
}

export function currentEvidenceStep(draft: WorkflowDraft, agentId: string, nodeId: string): WorkflowNode | null {
  if (!sameEvidenceUuid(draft.rootAgent.id, agentId) || !Object.prototype.hasOwnProperty.call(draft.nodes, nodeId)) return null;
  const node = draft.nodes[nodeId];
  return node?.id === nodeId && Object.values(draft.nodes).filter((item) => item.id === nodeId).length === 1 ? node : null;
}

export function checkedNodeEvidenceReport(raw: unknown, agentId: string, selected: RunSummary): RunReportFile | null {
  const parsed = RunReportFile.safeParse(raw);
  if (!parsed.success || !sameEvidenceUuid(selected.agentId, agentId)) return null;
  const run = parsed.data.run;
  return sameEvidenceUuid(run.id, selected.id) && sameEvidenceUuid(run.agentId, agentId)
    && run.sourceType === selected.sourceType && (selected.version === null || run.version === selected.version)
    ? parsed.data : null;
}

export function evidenceStepLabel(step: RunStepReport, index: number): string {
  const title = step.nodeTitle?.trim();
  return title && title !== step.nodeId && /\p{Script=Han}/u.test(title) ? redactSensitiveText(title) : `历史步骤 ${index + 1}`;
}

export function requestEvidenceStepFocus(detail: WorkflowNodeFocusDetail): boolean {
  const event = new CustomEvent<WorkflowNodeFocusDetail>(WORKFLOW_NODE_FOCUS_EVENT, { detail, cancelable: true });
  window.dispatchEvent(event);
  // 只有当前画布实际接收且核对通过才消费事件；没有监听者不算定位成功。
  return event.defaultPrevented;
}
