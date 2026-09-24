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

  it("接回死路、删除孤立节点并补充条件兜底", () => {
    const input = draft({
      start: { id: "start", title: "开始", type: "trigger", next: "condition" },
      condition: { id: "condition", title: "判断状态", type: "condition", condition: { source: "input.status", operator: "eq", branches: [{ label: "通过", value: "ok", next: "work" }], defaultNext: null } },
      work: { id: "work", title: "形成结论", type: "ai", next: null },
      orphan: { id: "orphan", title: "孤立步骤", type: "ai", next: null },
      done: { id: "done", title: "完成", type: "end" },
    });
    const result = applySafeAuditFixes(input);
    expect(result.draft.nodes.orphan).toBeUndefined();
    expect(result.draft.nodes.work.next).toBeTruthy();
    expect(result.draft.nodes.condition.condition?.defaultNext).toBeTruthy();
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
});
