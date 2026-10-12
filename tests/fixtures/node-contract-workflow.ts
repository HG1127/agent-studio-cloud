import { WorkflowDraft } from "../../src/contracts/workflow";

export const contractSchema = { type: "object", properties: { 金额: { type: "number" }, 同意: { type: "boolean" } }, required: ["金额", "同意"] };
export function nodeContractWorkflow() {
  return WorkflowDraft.parse({
    id: "node-contracts", startNodeId: "start",
    rootAgent: { id: "00000000-0000-4000-8000-0000000000c1", name: "字段核对助手", role: "整理材料" },
    memoryPolicy: { taskContext: true, longTerm: false },
    variables: [{ name: "payload", label: "业务材料", type: "object", required: true }],
    nodes: {
      start: { id: "start", title: "开始", type: "trigger", next: "top" },
      top: { id: "top", title: "整理业务材料", type: "ai", description: "整理原材料", next: "group", modelClass: "small", retry: { maxAttempts: 2, backoffMs: 500 } },
      group: { id: "group", title: "交付准备", type: "subflow", next: "parallel", subflow: {
        name: "交付准备", inputs: ["原材料"], outputs: ["整理记录"], failurePolicy: "continue",
        steps: [
          { id: "inner.with.dot", type: "ai", title: "检查材料", next: "原路径", retry: { maxAttempts: 2, backoffMs: 750 }, extra: { 保留: false }, requirementIds: ["原需求"] },
          { type: "ai", title: "整理结论", modelOutput: { format: "json", schema: contractSchema, mockOutput: { 金额: 0, 同意: false } }, extra: { 原内容: [0, false, null] } },
        ],
      } },
      parallel: { id: "parallel", title: "分别核对", type: "parallel", next: "done", parallel: {
        strategy: "all", failurePolicy: "continue", branches: [
          { id: "left.with.dot", label: "财务核对", steps: [{ id: "check", type: "ai", title: "核对金额", extra: { 保留: 0 } }] },
          { id: "right", label: "业务核对", steps: [{ id: "check", type: "ai", title: "核对说明" }] },
        ],
      } },
      done: { id: "done", title: "完成", type: "end" },
    },
  });
}
