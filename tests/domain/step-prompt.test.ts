// buildStepPrompt 纯函数单测：中文提示词组装（角色 + 本步目标 + 上游产出 + 质量返工要求）。
// 组装逻辑移植自旧系统 modelGateway.mjs 的 businessStepPrompt 并简化。
import { describe, expect, it } from "vitest";
import { buildStepPrompt } from "@/server/domain/runtime/step-prompt";
import type { WorkflowNode } from "@/contracts/workflow";

const node = {
  id: "analyze",
  title: "分析投诉原因",
  type: "ai",
  next: null,
  requirementIds: [],
  agent: { id: "agt_1", name: "客服助手", role: "通用业务助手" },
  description: "分析投诉原因并给出结论",
} as unknown as WorkflowNode;

describe("buildStepPrompt", () => {
  it("返回 system 与 user 两段提示词", () => {
    const result = buildStepPrompt({ node, upstreamOutputs: {}, input: {} });
    expect(Object.keys(result).sort()).toEqual(["system", "user"]);
  });

  it("system 包含节点标题与角色信息", () => {
    const { system } = buildStepPrompt({ node, upstreamOutputs: {}, input: {} });
    expect(system).toContain("分析投诉原因");
    expect(system).toContain("客服助手");
  });

  it("user 包含本步目标描述", () => {
    const { user } = buildStepPrompt({ node, upstreamOutputs: {}, input: {} });
    expect(user).toContain("分析投诉原因并给出结论");
  });

  it("user 包含上游产出文本", () => {
    const { user } = buildStepPrompt({
      node,
      upstreamOutputs: { fetch: "客户投诉物流发货延迟" },
      input: {},
    });
    expect(user).toContain("客户投诉物流发货延迟");
  });

  it("user 包含本次任务输入", () => {
    const { user } = buildStepPrompt({ node, upstreamOutputs: {}, input: { task: "客户咨询退款进度" } });
    expect(user).toContain("客户咨询退款进度");
  });

  it("带质量返工反馈时包含固定返工要求文案", () => {
    const { user } = buildStepPrompt({
      node,
      upstreamOutputs: {},
      input: {},
      qualityFeedback: "缺少结论段落",
    });
    expect(user).toContain("上一版质量检查未通过，必须修正后完整重写");
    expect(user).toContain("缺少结论段落");
  });

  it("无上游产出与输入时提示词仍然完整", () => {
    const { system, user } = buildStepPrompt({ node, upstreamOutputs: {}, input: {} });
    expect(system).toContain("分析投诉原因");
    expect(user).toContain("分析投诉原因");
  });
});
