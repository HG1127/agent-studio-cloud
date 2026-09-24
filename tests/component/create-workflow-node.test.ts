import { describe, expect, it } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";
import { createWorkflowNode } from "@/features/workflow-canvas/create-workflow-node";

const draft = WorkflowDraft.parse({
  id: "draft",
  rootAgent: { id: "agent", name: "测试助手", role: "业务助手" },
  memoryPolicy: { taskContext: true, longTerm: true },
  nodes: {
    start: { id: "start", title: "开始", type: "trigger", next: "done" },
    done: { id: "done", title: "完成", type: "end" },
  },
});

describe("新增画布节点", () => {
  it("生成不冲突的标识并保留原草稿", () => {
    const first = createWorkflowNode(draft, "ai");
    const second = createWorkflowNode(first.draft, "ai");
    expect(first.nodeId).toBe("ai_1");
    expect(second.nodeId).toBe("ai_2");
    expect(second.draft.nodes.start).toEqual(draft.nodes.start);
  });

  it("为需要配置的节点提供可运行的安全默认值", () => {
    expect(createWorkflowNode(draft, "human").draft.nodes.human_1.approval).toEqual({ role: "业务负责人", reason: "确认内容无误后继续" });
    expect(createWorkflowNode(draft, "tool").draft.nodes.tool_1.tool).toMatchObject({ registryToolId: "demo", risk: "low" });
    expect(createWorkflowNode(draft, "wait").draft.nodes.wait_1.wait).toMatchObject({ mode: "delay", durationMs: 60_000 });
    expect(createWorkflowNode(draft, "loop").draft.nodes.loop_1.loop).toMatchObject({ collectionPath: "input.items", maxIterations: 20 });
    expect(createWorkflowNode(draft, "parallel").draft.nodes.parallel_1.parallel?.branches).toHaveLength(2);
    expect(createWorkflowNode(draft, "subflow").draft.nodes.subflow_1.subflow?.steps).toHaveLength(1);
  });
});
