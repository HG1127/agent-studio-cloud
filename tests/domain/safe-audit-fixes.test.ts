import { describe, expect, it } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";
import { applySafeAuditFixes } from "@/server/domain/audit/safe-audit-fixes";

function draft(nodes: Record<string, unknown>, startNodeId = "start") {
  return WorkflowDraft.parse({
    id: "draft", startNodeId,
    rootAgent: { id: "agent", name: "测试助手", role: "业务助手" },
    memoryPolicy: { taskContext: true, longTerm: false },
    nodes,
  });
}

describe("设计检查安全修复", () => {
  it("补充交付契约与结果整理步骤，不伪造外部能力", () => {
    const input = draft({
      start: { id: "start", title: "开始", type: "trigger", next: "work" },
      work: { id: "work", title: "形成方案", type: "ai", next: "done" },
      done: { id: "done", title: "完成", type: "end" },
    });
    const result = applySafeAuditFixes(input);
    expect(result.draft.outputContract?.fields).toEqual([expect.objectContaining({ sourceNodeId: "work" })]);
    const delivery = Object.values(result.draft.nodes).find((node) => node.system?.kind === "deliver_output");
    expect(delivery).toMatchObject({ type: "system", next: "done" });
    expect(result.draft.nodes.work.next).toBe(delivery?.id);
    expect(input.outputContract).toBeUndefined();
  });

  it("接回死路、保留待连接节点并补充条件兜底", () => {
    const input = draft({
      start: { id: "start", title: "开始", type: "trigger", next: "condition" },
      condition: { id: "condition", title: "判断状态", type: "condition", condition: { source: "input.status", operator: "eq", branches: [{ label: "通过", value: "ok", next: "work" }], defaultNext: null } },
      work: { id: "work", title: "形成结论", type: "ai", next: null },
      orphan: { id: "orphan", title: "孤立步骤", type: "ai", next: null },
      done: { id: "done", title: "完成", type: "end" },
    });
    const result = applySafeAuditFixes(input);
    expect(result.draft.nodes.orphan).toBeDefined();
    expect(result.draft.nodes.work.next).toBeTruthy();
    expect(result.draft.nodes.condition.condition?.defaultNext).toBeTruthy();
  });

  it("不会按标题猜测并删除仍在业务路径中的节点", () => {
    const input = draft({
      start: { id: "start", title: "开始", type: "trigger", next: "assistant_step" },
      assistant_step: { id: "assistant_step", title: "客户服务助手", type: "ai", next: "done" },
      done: { id: "done", title: "完成", type: "end" },
    });

    const result = applySafeAuditFixes(input);

    expect(result.draft.nodes.assistant_step).toBeDefined();
    expect(result.draft.nodes.start.next).toBe("assistant_step");
    expect(result.applied.some((item) => item.includes("移除误识别"))).toBe(false);
  });

  it("业务证据与真实目标问题只记录为跳过，不凭空伪造", () => {
    const input = draft({
      start: { id: "start", title: "开始", type: "trigger", next: "call" },
      call: { id: "call", title: "请专业助手处理", type: "agent_call", next: "done", agentCall: { targetAgentId: "", versionId: "" } },
      done: { id: "done", title: "完成", type: "end" },
    });
    const result = applySafeAuditFixes(input);
    expect(result.draft.nodes.call.agentCall).toMatchObject({ targetAgentId: "", versionId: "" });
    expect(result.skipped).toContain("还没有选择可调用 Agent");
  });

  it("不会把隐藏的质量控制节点当作目标声明删除", () => {
    const input = draft({
      start: { id: "start", title: "开始", type: "trigger", next: "work" },
      work: { id: "work", title: "形成方案", type: "ai", next: "quality_review" },
      quality_review: {
        id: "quality_review", title: "交付前检查结果", type: "rule", next: "done",
        controlPlane: { kind: "quality", hiddenByDefault: true }, ui: { visibility: "control" },
        quality: { requiredOutputTitles: [], minOutputCount: 1 },
      },
      done: { id: "done", title: "完成", type: "end" },
    });
    const result = applySafeAuditFixes(input);
    expect(result.draft.nodes.quality_review).toBeDefined();
    expect(result.draft.outputContract?.fields).toEqual([expect.objectContaining({ sourceNodeId: "work" })]);
    expect(result.applied.some((item) => item.includes("移除误识别的目标声明"))).toBe(false);
  });

  it("把已有的控制节点交付来源改绑到业务步骤", () => {
    const input = draft({
      start: { id: "start", title: "开始", type: "trigger", next: "work" },
      work: { id: "work", title: "形成方案", type: "ai", next: "quality_review" },
      quality_review: {
        id: "quality_review", title: "交付前检查结果", type: "rule", next: "done",
        controlPlane: { kind: "quality", hiddenByDefault: true }, ui: { visibility: "control" },
        quality: { requiredOutputTitles: [], minOutputCount: 1 },
      },
      done: { id: "done", title: "完成", type: "end" },
    });
    input.outputContract = { fields: [{ path: "result", label: "处理结果", required: true, sourceNodeId: "quality_review" }] };

    const result = applySafeAuditFixes(input);

    expect(result.draft.outputContract?.fields).toEqual([
      expect.objectContaining({ path: "result", label: "处理结果", sourceNodeId: "work" }),
    ]);
    expect(result.applied).toContain("把失效的最终交付来源改为「形成方案」");
  });

  it("不会删除有意汇入同一步骤的不同业务条件", () => {
    const input = draft({
      start: { id: "start", title: "开始", type: "trigger", next: "check" },
      check: {
        id: "check", title: "判断客户类型", type: "condition",
        condition: {
          source: "input.customerType", operator: "eq", defaultNext: "done",
          branches: [
            { label: "新客户", value: "new", next: "prepare" },
            { label: "老客户", value: "returning", next: "prepare" },
          ],
        },
      },
      prepare: { id: "prepare", title: "准备方案", type: "ai", next: "done" },
      done: { id: "done", title: "完成", type: "end" },
    });

    const result = applySafeAuditFixes(input);

    expect(result.draft.nodes.check.condition?.branches).toHaveLength(2);
    expect(result.draft.nodes.check.condition?.branches.map((branch) => branch.label)).toEqual(["新客户", "老客户"]);
    expect(result.applied.some((item) => item.includes("重复分支"))).toBe(false);
  });
});
