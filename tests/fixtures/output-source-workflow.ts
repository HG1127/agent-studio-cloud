import { WorkflowDraft } from "../../src/contracts/workflow";

export function outputSourceWorkflow() {
  return WorkflowDraft.parse({
    id: "output-sources", startNodeId: "start",
    rootAgent: { id: "00000000-0000-4000-8000-0000000000b1", name: "材料助手", role: "记录材料" },
    memoryPolicy: { taskContext: true, longTerm: false },
    nodes: {
      start: { id: "start", title: "开始", type: "trigger", next: "group" },
      "group": { id: "group", title: "整理材料", type: "subflow", next: "parallel", subflow: {
        name: "材料准备", steps: [{ id: "child.with.dot", title: "登记材料", type: "system" }, { title: "核对材料", type: "system" }],
      } },
      parallel: { id: "parallel", title: "分别核对", type: "parallel", next: "done", parallel: {
        strategy: "all", failurePolicy: "continue", branches: [
          { id: "left.with.dot", label: "财务核对", steps: [{ id: "check", title: "记录金额", type: "system" }] },
          { id: "right", label: "业务核对", steps: [{ id: "check", title: "记录确认", type: "system" }] },
        ],
      } },
      done: { id: "done", title: "完成", type: "end" },
    },
    outputContract: { fields: [
      { path: "交付.金额", label: "金额", required: true, sourceNodeId: "group.child.with.dot", sourcePath: ["a.b", "0", "金额"] },
      { path: "交付.确认", label: "确认", required: true, sourceNodeId: "parallel.right.check", sourcePath: ["确认"] },
    ] },
  });
}
