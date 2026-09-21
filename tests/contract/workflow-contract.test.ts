import { describe, expect, it } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";

const baseDraft = {
  id: "wf_1",
  rootAgent: { id: "agent_1", name: "周报助手", role: "root" },
  nodes: {
    start: { id: "start", title: "开始", type: "trigger" },
    ai: { id: "ai", title: "生成周报", type: "ai" },
    done: { id: "done", title: "结束", type: "end" },
  },
  memoryPolicy: { taskContext: true, longTerm: false },
};

describe("WorkflowDraft", () => {
  it("接受 start→ai→done 三节点的最小合法草稿，解析出 3 个节点", () => {
    const result = WorkflowDraft.safeParse(baseDraft);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data.nodes)).toHaveLength(3);
    }
  });
  it("拒绝缺少 rootAgent 的草稿", () => {
    const withoutRootAgent = {
      id: baseDraft.id,
      nodes: baseDraft.nodes,
      memoryPolicy: baseDraft.memoryPolicy,
    };
    const result = WorkflowDraft.safeParse(withoutRootAgent);
    expect(result.success).toBe(false);
  });
  it("ui 缺省时得到空对象默认值", () => {
    const result = WorkflowDraft.parse(baseDraft);
    expect(result.ui).toEqual({ positions: {} });
  });
});
