import { describe, expect, it, vi } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import { RunInputPayload } from "@/contracts/run";
import { HarnessPolicy } from "@/contracts/harness";
import { evaluateHarnessPolicy, parseHarnessPolicy } from "./policy";
import { assessHarnessContext, MAX_HARNESS_PROMPT_CHARS, parseHarnessPromptLimit } from "./context-budget";

describe("确定性运行边界", () => {
  const subject = { nodeType: "tool" as const, nodeId: "group.read", registryToolId: "customer.lookup", scope: "customer.read", risk: "low" as const };
  it("未配置策略保留原行为，非法策略关闭调用", () => {
    expect(evaluateHarnessPolicy(parseHarnessPolicy(undefined)!, subject).allowed).toBe(true);
    for (const raw of ["invalid", '{"version":2,"rules":[]}', '{"version":1,"rules":[],"unknown":true}']) expect(parseHarnessPolicy(raw)).toBeNull();
  });
  it("拒绝重复编号和未知条件", () => {
    expect(HarnessPolicy.safeParse({ version: 1, rules: ["x", "x"].map((id) => ({ id, effect: "deny", when: {} })) }).success).toBe(false);
    expect(HarnessPolicy.safeParse({ version: 1, rules: [{ id: "x", effect: "deny", when: { protocol: "mcp" } }] }).success).toBe(false);
  });
  it("多条件必须同时匹配，拒绝优先于允许", () => {
    const policy = HarnessPolicy.parse({ version: 1, rules: [
      { id: "allow", effect: "allow", when: { risk: "low" } },
      { id: "deny", effect: "deny", when: { nodeType: "tool", scope: "customer.read", registryToolId: "customer.lookup" } },
    ] });
    expect(evaluateHarnessPolicy(policy, subject)).toMatchObject({ allowed: false, ruleId: "deny" });
    expect(evaluateHarnessPolicy(policy, { ...subject, scope: "other" }).allowed).toBe(true);
    expect(evaluateHarnessPolicy(policy, { ...subject, nodeType: "ai" }).allowed).toBe(true);
  });
  it.each(["0", "999", "128001", "1e3", "-1000", "abc"])("拒绝非法容量 %s", (raw) => { expect(parseHarnessPromptLimit(raw)).toBeNull(); });
  it("默认整体容量含系统提示，合法数值不扩展原上限", () => {
    expect(parseHarnessPromptLimit(undefined)).toBe(MAX_HARNESS_PROMPT_CHARS); expect(parseHarnessPromptLimit(" 1000 ")).toBe(1000);
  });
  const args = { node: WorkflowNode.parse({ id: "ai", type: "ai", title: "整理客户" }), input: { n: 0, flag: false }, upstreamOutputs: {} };
  it("不允许隐式截断业务输入或上游成果", () => {
    expect(assessHarnessContext(args, MAX_HARNESS_PROMPT_CHARS).ok).toBe(true);
    expect(assessHarnessContext({ ...args, input: { text: "中".repeat(32_001) } }, MAX_HARNESS_PROMPT_CHARS).ok).toBe(false);
    expect(assessHarnessContext({ ...args, upstreamOutputs: { x: "x".repeat(64_001) } }, MAX_HARNESS_PROMPT_CHARS).ok).toBe(false);
    expect(assessHarnessContext({ ...args, qualityFeedback: "x".repeat(16_001) }, MAX_HARNESS_PROMPT_CHARS).ok).toBe(false);
  });
  it("实际提示与字段规则一起计算，容量不足时不调用模型", () => {
    const node = WorkflowNode.parse({ ...args.node, modelOutput: { format: "json", schema: { type: "object", description: "x".repeat(1500) } } });
    expect(assessHarnessContext({ ...args, node }, 1000).ok).toBe(false);
  });
  it("每段合法也拒绝因完整输出字段挤占而裁剪组合正文", () => {
    const node = WorkflowNode.parse({ ...args.node, modelOutput: { format: "json", schema: { type: "object", description: "x".repeat(30_000) } } });
    const input = RunInputPayload.parse({ text: "i".repeat(31_900) });
    const upstreamOutputs = { report: "u".repeat(63_900) };
    expect(JSON.stringify(input, null, 2).length).toBeLessThan(32_000);
    expect(`- report：${upstreamOutputs.report}`.length).toBeLessThan(64_000);
    expect(assessHarnessContext({ ...args, node, input, upstreamOutputs }, MAX_HARNESS_PROMPT_CHARS).ok).toBe(false);
  });
  it("业务正文中的截断字样不是实际容量裁剪", () => {
    expect(assessHarnessContext({ ...args, input: { text: "\n…[内容过长，已截断]…\n" } }, MAX_HARNESS_PROMPT_CHARS).ok).toBe(true);
  });
  it("访问器不能参与上下文组装", () => {
    const getter = vi.fn();
    expect(assessHarnessContext({ ...args, input: { get x() { getter(); return "x"; } } }, MAX_HARNESS_PROMPT_CHARS).ok).toBe(false); expect(getter).not.toHaveBeenCalled();
  });
});
