import { describe, expect, it } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import { RunInputPayload } from "@/contracts/run";
import { buildStepPrompt, buildStepPromptWithBudget, MAX_STEP_USER_PROMPT_CHARS } from "./step-prompt";

const args = { node: WorkflowNode.parse({ id: "summarize", type: "ai", title: "整理输入" }), input: { text: "真实输入" }, upstreamOutputs: {} };

describe("提示组装的实际裁剪状态", () => {
  it("普通提示保持原返回形状与完整正文", () => {
    const { truncated, ...prompt } = buildStepPromptWithBudget(args);
    expect(truncated).toBe(false);
    expect(buildStepPrompt(args)).toEqual(prompt);
    expect(Object.keys(buildStepPrompt(args))).toEqual(["system", "user"]);
    expect(prompt.user).toContain("真实输入");
  });
  it("合法输出字段与各段组合超限可量到实际整体裁剪", () => {
    const node = WorkflowNode.parse({ ...args.node, modelOutput: { format: "json", schema: { type: "object", description: "s".repeat(30_000) } } });
    const combined = { ...args, node, input: RunInputPayload.parse({ text: "i".repeat(31_900) }), upstreamOutputs: { report: "u".repeat(63_900) } };
    const { truncated, ...prompt } = buildStepPromptWithBudget(combined);
    expect(truncated).toBe(true);
    expect(prompt.user.length).toBeLessThanOrEqual(MAX_STEP_USER_PROMPT_CHARS);
    expect(prompt.user).toContain(JSON.stringify(node.modelOutput!.schema));
    expect(buildStepPrompt(combined)).toEqual(prompt);
  });
  it.each([
    { label: "标题", input: { ...args, node: { ...args.node, title: "x".repeat(1001) } } },
    { label: "目标", input: { ...args, node: { ...args.node, description: "x".repeat(4001) } } },
    { label: "任务输入", input: { ...args, input: { text: "x".repeat(32_001) } } },
    { label: "上游成果", input: { ...args, upstreamOutputs: { report: "x".repeat(64_001) } } },
    { label: "质量反馈", input: { ...args, qualityFeedback: "x".repeat(16_001) } },
    { label: "上游组合", input: { ...args, upstreamOutputs: { first: "x".repeat(32_000), second: "x".repeat(32_000) } } },
  ])("记录每处真实裁剪：$label", ({ input }) => {
    const { truncated, ...prompt } = buildStepPromptWithBudget(input);
    expect(truncated).toBe(true);
    expect(buildStepPrompt(input)).toEqual(prompt);
  });
  it("不能因正文含相同标记而误报裁剪，也不串用其他调用状态", () => {
    buildStepPromptWithBudget({ ...args, qualityFeedback: "x".repeat(16_001) });
    const legitimate = { ...args, input: { text: "\n…[内容过长，已截断]…\n" } };
    expect(buildStepPromptWithBudget(legitimate).truncated).toBe(false);
    expect(buildStepPrompt(legitimate).user).toContain("…[内容过长，已截断]…");
  });
});
