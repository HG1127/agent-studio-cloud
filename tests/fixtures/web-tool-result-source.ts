import { RunStepView, RunView } from "@/contracts/run";

export const webToolSourceRunId = "00000000-0000-4000-8000-000000000811";
export const webToolSourceVersionId = "00000000-0000-4000-8000-000000000812";
const now = new Date("2026-10-09T04:00:00.000Z");
const conditionOutput = { matched: "需要继续处理", next: "private-next-step", note: "核对后的业务内容" };

export const webToolSourceRun = RunView.parse({
  id: webToolSourceRunId, agentId: "00000000-0000-4000-8000-000000000813", agentName: "条件核对助手", versionId: webToolSourceVersionId, version: 4, status: "completed", sourceType: "manual", input: {},
  result: { decision: conditionOutput },
  outputContract: { fields: [{ path: "decision", label: "判断依据", required: true, sourceNodeId: "private-condition-step", sourcePath: [] }] },
  error: null, startedAt: null, finishedAt: null,
});

export const webToolSourceSteps = [
  RunStepView.parse({ id: "00000000-0000-4000-8000-000000000814", runId: webToolSourceRunId, nodeId: "private-condition-step", nodeTitle: "核对处理去向", nodeType: "condition", status: "succeeded", attempt: 1, output: conditionOutput, error: "private-step-error", startedAt: now, finishedAt: now, createdAt: now, updatedAt: now }),
  RunStepView.parse({ id: "00000000-0000-4000-8000-000000000815", runId: webToolSourceRunId, nodeId: "private-next-step", nodeTitle: "整理业务结论", nodeType: "ai", status: "succeeded", attempt: 1, output: { content: "private-step-only-body", token: "private-step-credential" }, error: "private-destination-error", startedAt: now, finishedAt: now, createdAt: now, updatedAt: now }),
];
