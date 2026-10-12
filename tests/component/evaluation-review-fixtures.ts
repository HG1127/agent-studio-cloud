import { EvaluationRunView } from "@/contracts/evaluation";
import { RunReportFile, RunView } from "@/contracts/run";

export const agentId = "00000000-0000-4000-8000-000000000201";
export const batchId = "00000000-0000-4000-8000-000000000202";
export const caseId = "00000000-0000-4000-8000-000000000203";
export const runId = "00000000-0000-4000-8000-000000000204";
export const otherId = "00000000-0000-4000-8000-000000000205";
export const date = "2026-10-09T01:00:00.000Z";
export const evaluation = EvaluationRunView.parse({
  id: batchId, version: 4, status: "completed", totalCount: 1, passedCount: 0, failedCount: 1,
  startedAt: date, finishedAt: date,
  results: [{ caseId, caseName: "客户方案", status: "failed", error: "结果未包含预期文字", runId }],
});
export const report = RunReportFile.parse({
  format: "agent-studio-cloud-run", formatVersion: 1, exportedAt: date,
  run: RunView.parse({
    id: runId, agentId, agentName: "业务核对助手", version: 4, sourceType: "evaluation", status: "completed",
    input: { brief: "当时的客户需求", amount: 0, approved: false, apiKey: "hidden-test-credential" },
    inputContract: { fields: [{ name: "brief", label: "客户需求", type: "string", required: true }] },
    result: { deliver: { content: "这次实际交付", count: 0, checked: false }, apiKey: "hidden-test-credential" },
    outputContract: { fields: [{ path: "deliver", label: "客户方案", required: true, sourceNodeId: "deliver" }] },
    error: null, startedAt: date, finishedAt: date,
  }),
  context: null, steps: [], trace: [], approvals: [],
});
