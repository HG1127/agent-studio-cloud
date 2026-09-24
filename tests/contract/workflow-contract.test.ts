import { describe, expect, it } from "vitest";
import {
  MAX_CONDITION_BRANCHES,
  MAX_PARALLEL_BRANCHES,
  MAX_WORKFLOW_BYTES,
  MAX_WORKFLOW_NODES,
  WorkflowDraft,
  WorkflowNode,
} from "@/contracts/workflow";

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
  it("ui 内层缺 positions 时同样得到空对象默认值", () => {
    const result = WorkflowDraft.parse({ ...baseDraft, ui: {} });
    expect(result.ui).toEqual({ positions: {} });
  });
  it("限制流程总步骤数、条件分支和并行工作数量", () => {
    const nodes = Object.fromEntries(Array.from({ length: MAX_WORKFLOW_NODES + 1 }, (_, index) => [
      `node_${index}`,
      { id: `node_${index}`, title: `步骤 ${index}`, type: "system" },
    ]));
    expect(WorkflowDraft.safeParse({ ...baseDraft, nodes }).success).toBe(false);
    expect(WorkflowNode.safeParse({
      id: "condition", title: "判断", type: "condition",
      condition: { source: "input.value", branches: Array.from({ length: MAX_CONDITION_BRANCHES + 1 }, (_, index) => ({ label: `情况 ${index}`, next: null })) },
    }).success).toBe(false);
    expect(WorkflowNode.safeParse({
      id: "parallel", title: "并行", type: "parallel",
      parallel: {
        strategy: "all", failurePolicy: "fail_fast",
        branches: Array.from({ length: MAX_PARALLEL_BRANCHES + 1 }, (_, index) => ({ id: `branch_${index}`, label: `工作 ${index}`, steps: [{ id: "step", title: "处理", type: "ai" }] })),
      },
    }).success).toBe(false);
  });
  it("限制流程草稿整体大小", () => {
    expect(WorkflowDraft.safeParse({
      ...baseDraft,
      businessGrounding: { source: "字".repeat(MAX_WORKFLOW_BYTES) },
    }).success).toBe(false);
  });
});
