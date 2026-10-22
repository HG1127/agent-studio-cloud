import { describe, expect, it } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";
import { changeWorkflowNodeType } from "@/features/workflow-canvas/change-workflow-node-type";
import { createWorkflowNode } from "@/features/workflow-canvas/create-workflow-node";
import { validateWorkflowRoutes } from "@/server/domain/runtime/workflow-routes";

const draft = WorkflowDraft.parse({
  id: "type-change",
  startNodeId: "start",
  rootAgent: { id: "agent", name: "测试助手", role: "处理" },
  memoryPolicy: { taskContext: true, longTerm: false },
  ui: { positions: { work: { x: 180, y: 90 } } },
  outputContract: { fields: [
    { path: "work.result", label: "旧交付", sourceNodeId: "work" },
    { path: "other.result", label: "其他交付", sourceNodeId: "other" },
  ] },
  nodes: {
    start: { id: "start", title: "开始", type: "trigger", next: "work" },
    work: { id: "work", title: "处理任务", type: "ai", description: "核对任务内容", next: "done", businessSpec: { objective: "旧目标" }, requirementIds: ["need-1"] },
    other: { id: "other", title: "其他任务", type: "ai", next: "done" },
    done: { id: "done", title: "完成", type: "end" },
  },
});

describe("画布步骤类型转换", () => {
  it("重建专属设置而保留名称、位置和主路径，清除失效业务依据与交付字段", () => {
    const result = changeWorkflowNodeType(draft, "work", "tool");
    if ("error" in result) throw new Error(result.error);
    expect(result.draft.nodes.work).toMatchObject({
      id: "work", type: "tool", title: "处理任务", description: "核对任务内容", next: "done",
      requirementIds: ["need-1"], businessSpec: null,
      tool: { registryToolId: null, protocol: "unbound", unresolved: true },
    });
    expect(result.draft.nodes.work.approval).toBeUndefined();
    expect(result.draft.ui.positions.work).toEqual({ x: 180, y: 90 });
    expect(result.removedOutputFields).toEqual(["旧交付"]);
    expect(result.draft.outputContract?.fields.map((field) => field.label)).toEqual(["其他交付"]);
    expect(draft.nodes.work.type).toBe("ai");
    expect(draft.outputContract?.fields).toHaveLength(2);
    expect(WorkflowDraft.safeParse(result.draft).success).toBe(true);
    expect(validateWorkflowRoutes(result.draft)).toBeNull();
  });

  it("判断与逐项处理的主出口转换后接回正常路径，同时显式列出失去的分支", () => {
    const condition = WorkflowDraft.parse({
      ...draft,
      nodes: {
        ...draft.nodes,
        work: { id: "work", title: "分情况", type: "condition", next: null, onErrorNext: "other",
          condition: { source: "input.status", operator: "eq", branches: [{ label: "通过", value: "yes", next: "other" }], defaultNext: "done" } },
      },
    });
    const asAi = changeWorkflowNodeType(condition, "work", "ai");
    if ("error" in asAi) throw new Error(asAi.error);
    expect(asAi.draft.nodes.work.next).toBe("done");
    expect(asAi.draft.nodes.work.condition).toBeUndefined();
    expect(asAi.draft.nodes.work.onErrorNext).toBe("other");
    expect(asAi.droppedRoutes).toEqual(["通过"]);

    const asLoop = changeWorkflowNodeType(draft, "work", "loop");
    if ("error" in asLoop) throw new Error(asLoop.error);
    expect(asLoop.draft.nodes.work.next).toBeNull();
    expect(asLoop.draft.nodes.work.loop?.exitNext).toBe("done");
    expect(asLoop.draft.nodes.work.loop?.bodyNext).toBeNull();
    expect(WorkflowDraft.safeParse(asLoop.draft).success).toBe(true);
  });

  it("控制节点及其依附步骤不能转换，也不能静默丢弃通向隐藏检查的分支", () => {
    expect(changeWorkflowNodeType(draft, "start", "ai")).toHaveProperty("error");
    expect(changeWorkflowNodeType(draft, "done", "ai")).toHaveProperty("error");
    const controlled = WorkflowDraft.parse({
      ...draft,
      nodes: {
        ...draft.nodes,
        receipt: { id: "receipt", title: "检查回执", type: "rule", rule: { kind: "tool_result", sourceNodeId: "work" }, next: "done", controlPlane: { kind: "receipt", hiddenByDefault: true } },
      },
    });
    expect(changeWorkflowNodeType(controlled, "work", "tool")).toHaveProperty("error");
    expect(changeWorkflowNodeType(controlled, "receipt", "ai")).toHaveProperty("error");

    const hiddenBranch = WorkflowDraft.parse({
      ...draft,
      nodes: {
        ...draft.nodes,
        work: { id: "work", title: "分情况", type: "condition", condition: { source: "input.status", branches: [{ label: "需检查", next: "guard" }], defaultNext: "done" } },
        guard: { id: "guard", title: "控制检查", type: "rule", rule: { kind: "business_rule" }, next: "done", ui: { visibility: "control" } },
      },
    });
    expect(changeWorkflowNodeType(hiddenBranch, "work", "ai")).toHaveProperty("error");
  });

  it("新增规则和运行记录使用真实可执行模板，不预置外部操作", () => {
    const rule = createWorkflowNode(draft, "rule").draft.nodes.rule_1;
    const system = createWorkflowNode(draft, "system").draft.nodes.system_1;
    expect(rule.rule?.kind).toBe("business_rule");
    expect(system.system?.kind).toBe("summary");
    expect(system.tool).toBeUndefined();
  });
});
