import { describe, expect, it } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";
import { updateWorkflowNode } from "@/features/workflow-canvas/update-workflow-node";

const draft = WorkflowDraft.parse({
  id: "draft",
  rootAgent: { id: "agent", name: "客服助手", role: "客服" },
  memoryPolicy: { taskContext: true, longTerm: false },
  nodes: {
    start: { id: "start", title: "收到任务", type: "trigger", next: "knowledge" },
    knowledge: { id: "knowledge", title: "检索退货资料", type: "knowledge", next: "review", knowledge: { space: "业务资料库", query: "检索退货资料" } },
    review: { id: "review", title: "交付前检查", type: "rule", next: "done", quality: { requiredOutputTitles: ["检索退货资料"], minOutputCount: 1 } },
    done: { id: "done", title: "结束", type: "end" },
  },
});

describe("updateWorkflowNode", () => {
  it("知识节点改名时同步检索内容和交付前检查引用", () => {
    const next = updateWorkflowNode(draft, "knowledge", { ...draft.nodes.knowledge, title: "检索海蓝灯塔二四资料" });
    expect(next.nodes.knowledge.knowledge?.query).toBe("检索海蓝灯塔二四资料");
    expect(next.nodes.review.quality?.requiredOutputTitles).toEqual(["检索海蓝灯塔二四资料"]);
  });

  it("用户单独指定的检索内容在改名后保留", () => {
    const next = updateWorkflowNode(draft, "knowledge", {
      ...draft.nodes.knowledge,
      title: "查阅资料",
      knowledge: { space: "业务资料库", query: "退货政策" },
    });
    expect(next.nodes.knowledge.knowledge?.query).toBe("退货政策");
  });
});
