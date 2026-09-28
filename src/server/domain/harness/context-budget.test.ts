import { describe, expect, it } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import { assessHarnessContext, parseHarnessPromptLimit } from "./context-budget";

const node = WorkflowNode.parse({ id: "answer", title: "整理结果", type: "ai", next: null });

describe("Harness 模型上下文预算", () => {
  it("拒绝无效预算并允许正常输入", () => {
    expect(parseHarnessPromptLimit("not-a-number")).toBeNull();
    expect(parseHarnessPromptLimit("999")).toBeNull();
    expect(parseHarnessPromptLimit(undefined)).toBe(120_000);
    expect(assessHarnessContext({ node, upstreamOutputs: {}, input: { task: "回复客户" } }, 120_000)).toMatchObject({ allowed: true, reason: null });
  });

  it("关键任务输入超限时明确阻止，不把被截断的提示词送出", () => {
    const result = assessHarnessContext({ node, upstreamOutputs: {}, input: { task: "内容".repeat(20_000) } }, 120_000);
    expect(result).toMatchObject({ allowed: false, reason: "本次任务输入超过模型上下文上限" });
    expect(result.usedChars).toBeGreaterThan(32_000);
  });

  it("上游成果和自定义预算超限均阻止调用", () => {
    expect(assessHarnessContext({ node, upstreamOutputs: { source: "x".repeat(64_001) }, input: {} }, 120_000))
      .toMatchObject({ allowed: false, reason: expect.stringContaining("上游成果超过") });
    expect(assessHarnessContext({ node, upstreamOutputs: {}, input: { task: "x".repeat(3_000) } }, 1_000))
      .toMatchObject({ allowed: false, reason: "模型上下文超过本次运行预算" });
  });
});
