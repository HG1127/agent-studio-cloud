import { WorkflowDraft, type WorkflowOutputField } from "@/contracts/workflow";

export function outputPreviewWorkflow(fields: WorkflowOutputField[] = [{ path: "交付.金额", required: true, sourceNodeId: "extract", sourcePath: ["rows", "0", "amount"] }]): WorkflowDraft {
  return WorkflowDraft.parse({
    id: "preview", rootAgent: { id: "agent", name: "业务助手", role: "处理" }, memoryPolicy: { taskContext: true, longTerm: false },
    nodes: {
      start: { id: "start", title: "开始", type: "trigger", next: "extract" },
      extract: { id: "extract", title: "提取业务对象", type: "ai", next: "group" },
      group: { id: "group", title: "顺序处理", type: "subflow", next: "batch", subflow: { name: "处理", steps: [{ id: "extract", title: "内部提取", type: "ai" }] } },
      batch: { id: "batch", title: "并行处理", type: "parallel", next: "done", parallel: { strategy: "all_settled", failurePolicy: "continue", branches: [
        { id: "work", label: "业务处理", steps: [{ id: "extract", title: "业务提取", type: "ai" }] },
        { id: "other", label: "其他处理", steps: [{ id: "extract", title: "其他提取", type: "ai" }] },
      ] } },
      done: { id: "done", title: "结束", type: "end" },
    }, outputContract: { fields },
  });
}

export function outputPreviewRequest() {
  return { workflow: outputPreviewWorkflow(), outputs: { extract: { rows: [{ amount: 0, approved: false, email: "business@example.com" }] } } };
}
