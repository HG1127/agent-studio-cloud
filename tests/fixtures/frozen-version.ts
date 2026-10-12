import { AgentManifest } from "@/contracts/manifest";
import { WorkflowDraft } from "@/contracts/workflow";

export const frozenAgentId = "00000000-0000-4000-8000-000000000071";
export const frozenVersionId = "00000000-0000-4000-8000-000000000072";
export const frozenDraft = WorkflowDraft.parse({
  id: "frozen-workflow", startNodeId: "start", rootAgent: { id: frozenAgentId, name: "冻结客服助手", role: "业务助手" },
  nodes: {
    start: { id: "start", title: "收到客户任务", type: "trigger", next: "compose" },
    compose: { id: "compose", title: "冻结的回复方案", type: "ai", description: "按原有要求核对依据", purpose: "apiKey=private-frozen-secret-2026", next: "approve", onErrorNext: "done", retry: { maxAttempts: 3, backoffMs: 100 } },
    approve: { id: "approve", title: "负责人确认", type: "human", next: "quality", rejectNext: "done", approval: { role: "owner", reason: "确认后才能继续" } },
    quality: { id: "quality", title: "已冻结结果检查", type: "rule", next: "done", rule: { kind: "quality" }, ui: { visibility: "control" }, controlPlane: { kind: "quality", hiddenByDefault: true } },
    done: { id: "done", title: "交付完成", type: "end" },
  }, memoryPolicy: { taskContext: true, longTerm: false },
  ui: { positions: { start: { x: -300, y: 0 }, compose: { x: 0, y: 0 }, approve: { x: 300, y: 0 }, quality: { x: 600, y: 0 }, done: { x: 900, y: 0 } } },
});
export const frozenManifest = AgentManifest.parse({
  schemaVersion: "4.0", workflowSnapshot: frozenDraft, workflowFingerprint: "frozen-fingerprint",
  inputContract: { fields: [{ name: "privateBusinessInput", label: "冻结的业务任务", type: "string" }, { name: "amount", type: "number", required: false }] },
  outputContract: { fields: [{ path: "privateOutput.path", label: "冻结的交付结论", required: true, sourceNodeId: "compose" }] },
  resourceSelection: { model: { modelId: "test-model", mock: true } }, designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
});
