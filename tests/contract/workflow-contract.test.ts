import { describe, expect, it } from "vitest";
import {
  MAX_CONDITION_BRANCHES,
  MAX_PARALLEL_BRANCHES,
  MAX_WORKFLOW_BYTES,
  MAX_WORKFLOW_NODES,
  MAX_WORKFLOW_OUTPUT_FIELDS,
  MAX_WORKFLOW_VARIABLES,
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

  it("拒绝自由字段中会被 JSON 序列化静默改写的值", () => {
    for (const value of [undefined, () => "ignored", new Date("2026-09-27"), Number.NaN]) {
      expect(WorkflowDraft.safeParse({
        ...baseDraft,
        businessGrounding: { source: value },
      }).success).toBe(false);
    }
  });

  it("条件编辑器显式清空可选规则时仍可保存草稿", () => {
    const parsed = WorkflowDraft.safeParse({
      ...baseDraft,
      nodes: {
        ...baseDraft.nodes,
        condition: {
          id: "condition", title: "判断", type: "condition",
          condition: {
            source: "input.ready",
            branches: [{ label: "是", value: true, next: "done", rules: undefined, mode: undefined }],
            defaultNext: "done",
          },
        },
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.nodes.condition.condition?.branches[0]).not.toHaveProperty("rules");
      expect(parsed.data.nodes.condition.condition?.branches[0]).not.toHaveProperty("mode");
    }
  });

  it("条件规则未填写比较值时不会保留 undefined 字段", () => {
    const branch = WorkflowDraft.parse({
      ...baseDraft,
      nodes: {
        ...baseDraft.nodes,
        condition: {
          id: "condition", title: "判断", type: "condition",
          condition: {
            source: "input.ready",
            branches: [{ label: "是", next: "done", rules: [{ source: "input.ready", operator: "exists", value: undefined }] }],
          },
        },
      },
    }).nodes.condition.condition?.branches[0];
    expect(branch?.rules?.[0]).not.toHaveProperty("value");
  });

  it("节点编辑器清空可选交接配置时不保留 undefined 字段", () => {
    const draft = WorkflowDraft.parse({
      ...baseDraft,
      nodes: {
        ...baseDraft.nodes,
        handoff: { id: "handoff", title: "交接", type: "handoff", contract: undefined },
      },
    });
    expect(draft.nodes.handoff).not.toHaveProperty("contract");
  });

  it("拒绝对象原型名称和标识错位的顶层步骤", () => {
    const inheritedNameNodes = { ...baseDraft.nodes } as Record<string, unknown>;
    Object.defineProperty(inheritedNameNodes, "toString", {
      configurable: true,
      enumerable: true,
      value: { id: "toString", title: "危险步骤", type: "system" },
    });
    expect(WorkflowDraft.safeParse({ ...baseDraft, nodes: inheritedNameNodes }).success).toBe(false);
    expect(WorkflowDraft.safeParse({
      ...baseDraft,
      nodes: { ...baseDraft.nodes, mismatched: { id: "another", title: "错位步骤", type: "system" } },
    }).success).toBe(false);
  });

  it("步骤组只接受明确的失败处理策略", () => {
    expect(WorkflowNode.safeParse({
      id: "group", title: "准备材料", type: "subflow",
      subflow: { name: "准备材料", steps: [{ id: "draft", title: "起草", type: "ai" }], failurePolicy: "continute" },
    }).success).toBe(false);
    expect(WorkflowNode.parse({
      id: "group", title: "准备材料", type: "subflow",
      subflow: { name: "准备材料", steps: [{ id: "draft", title: "起草", type: "ai" }] },
    }).subflow?.failurePolicy).toBe("checkpoint");
  });

  it("质量门禁只接受安全范围内的整数结果门槛", () => {
    expect(WorkflowNode.safeParse({
      id: "quality", title: "交付检查", type: "rule",
      quality: { requiredOutputTitles: [], minOutputCount: -1 },
    }).success).toBe(false);
    expect(WorkflowNode.safeParse({
      id: "quality", title: "交付检查", type: "rule",
      quality: { requiredOutputTitles: [], minOutputCount: 1.5 },
    }).success).toBe(false);
  });

  it("限制最终交付字段数量和字段长度", () => {
    expect(WorkflowDraft.safeParse({
      ...baseDraft,
      outputContract: {
        fields: Array.from({ length: MAX_WORKFLOW_OUTPUT_FIELDS + 1 }, (_, index) => ({
          path: `result_${index}`, required: true, sourceNodeId: "ai",
        })),
      },
    }).success).toBe(false);
    expect(WorkflowDraft.safeParse({
      ...baseDraft,
      outputContract: { fields: [{ path: "x".repeat(201), required: true, sourceNodeId: "ai" }] },
    }).success).toBe(false);
  });

  it("限制运行输入字段数量和文本长度", () => {
    expect(WorkflowDraft.safeParse({
      ...baseDraft,
      variables: Array.from({ length: MAX_WORKFLOW_VARIABLES + 1 }, (_, index) => ({ name: `field_${index}` })),
    }).success).toBe(false);
    expect(WorkflowDraft.safeParse({
      ...baseDraft,
      variables: [{ name: "x".repeat(201), label: "正常名称" }],
    }).success).toBe(false);
    expect(WorkflowDraft.safeParse({
      ...baseDraft,
      variables: [{ name: "brief", label: "字".repeat(201) }],
    }).success).toBe(false);
  });
});
