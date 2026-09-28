import { describe, expect, it } from "vitest";
import { MAX_WORKFLOW_NODES, WorkflowDraft } from "@/contracts/workflow";
import { canAddWorkflowNode, createWorkflowNode, insertWorkflowNodeAfter } from "@/features/workflow-canvas/create-workflow-node";

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

  it("需要外部能力的步骤先保持未绑定，不默认冒充演示服务", () => {
    expect(createWorkflowNode(draft, "human").draft.nodes.human_1.approval).toEqual({ role: "业务负责人", reason: "确认内容无误后继续" });
    const tool = createWorkflowNode(draft, "tool");
    expect(tool.draft.nodes.tool_1.tool).toMatchObject({ registryToolId: null, protocol: "unbound", unresolved: true, risk: "high" });
    expect(WorkflowDraft.safeParse(tool.draft).success).toBe(true);
    expect(createWorkflowNode(draft, "wait").draft.nodes.wait_1.wait).toMatchObject({ mode: "delay", durationMs: 60_000 });
    expect(createWorkflowNode(draft, "loop").draft.nodes.loop_1.loop).toMatchObject({ collectionPath: "input.items", maxIterations: 20 });
    expect(createWorkflowNode(draft, "parallel").draft.nodes.parallel_1.parallel?.branches).toHaveLength(2);
    expect(createWorkflowNode(draft, "subflow").draft.nodes.subflow_1.subflow?.steps).toHaveLength(1);
  });

  it("达到流程步骤上限后不再允许新增", () => {
    const nodes = Object.fromEntries(Array.from({ length: MAX_WORKFLOW_NODES }, (_, index) => [
      `node_${index}`,
      { id: `node_${index}`, title: `步骤 ${index + 1}`, type: index === 0 ? "trigger" as const : "ai" as const, next: null },
    ]));

    expect(canAddWorkflowNode({ nodes })).toBe(false);
    expect(canAddWorkflowNode({ nodes: Object.fromEntries(Object.entries(nodes).slice(1)) })).toBe(true);
  });

  it("插入线性步骤时保留原后续路径，且不改动原草稿", () => {
    const inserted = insertWorkflowNodeAfter(draft, "ai", "start");
    expect(inserted).not.toHaveProperty("error");
    if ("error" in inserted) return;
    expect(inserted.draft.nodes.start.next).toBe(inserted.nodeId);
    expect(inserted.draft.nodes[inserted.nodeId].next).toBe("done");
    expect(draft.nodes.start.next).toBe("done");
    expect(WorkflowDraft.safeParse(inserted.draft).success).toBe(true);
  });

  it("插入判断或逐项处理时通过否则或完成路径接回原后续", () => {
    const condition = insertWorkflowNodeAfter(draft, "condition", "start");
    const loop = insertWorkflowNodeAfter(draft, "loop", "start");
    if ("error" in condition || "error" in loop) throw new Error("插入应成功");
    expect(condition.draft.nodes[condition.nodeId].next).toBeNull();
    expect(condition.draft.nodes[condition.nodeId].condition?.defaultNext).toBe("done");
    expect(loop.draft.nodes[loop.nodeId].next).toBeNull();
    expect(loop.draft.nodes[loop.nodeId].loop?.exitNext).toBe("done");
  });

  it("保留父步骤的其他分支、循环体与隐藏控制链", () => {
    const branched = WorkflowDraft.parse({
      ...draft,
      nodes: {
        ...draft.nodes,
        start: { ...draft.nodes.start, next: "choice" },
        choice: { id: "choice", title: "判断", type: "condition", condition: { source: "input.status", operator: "eq", branches: [{ label: "通过", next: "approved" }], defaultNext: "guard" } },
        approved: { id: "approved", title: "通过", type: "ai", next: "done" },
        guard: { id: "guard", title: "安全检查", type: "rule", rule: { kind: "business_rule" }, ui: { visibility: "control" }, next: "done" },
      },
    });
    const afterChoice = insertWorkflowNodeAfter(branched, "ai", "choice");
    if ("error" in afterChoice) throw new Error(afterChoice.error);
    expect(afterChoice.draft.nodes.choice.condition?.branches[0].next).toBe("approved");
    expect(afterChoice.draft.nodes.choice.condition?.defaultNext).toBe(afterChoice.nodeId);
    expect(afterChoice.draft.nodes[afterChoice.nodeId].next).toBe("guard");

    const withLoop = WorkflowDraft.parse({
      ...draft,
      nodes: {
        ...draft.nodes,
        start: { ...draft.nodes.start, next: "repeat" },
        repeat: { id: "repeat", title: "逐项处理", type: "loop", loop: { collectionPath: "input.items", itemKey: "item", maxIterations: 5, bodyNext: "body", exitNext: "done" } },
        body: { id: "body", title: "处理一项", type: "ai", next: "repeat" },
      },
    });
    const afterLoop = insertWorkflowNodeAfter(withLoop, "ai", "repeat");
    if ("error" in afterLoop) throw new Error(afterLoop.error);
    expect(afterLoop.draft.nodes.repeat.loop?.bodyNext).toBe("body");
    expect(afterLoop.draft.nodes.repeat.loop?.exitNext).toBe(afterLoop.nodeId);
    expect(afterLoop.draft.nodes[afterLoop.nodeId].next).toBe("done");
  });

  it("无效位置和完成节点不会产生新步骤", () => {
    expect(insertWorkflowNodeAfter(draft, "ai", "missing")).toHaveProperty("error");
    expect(insertWorkflowNodeAfter(draft, "ai", "done")).toHaveProperty("error");
    expect(Object.keys(draft.nodes)).toEqual(["start", "done"]);
  });
});
