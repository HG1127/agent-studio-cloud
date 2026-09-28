import { describe, expect, it } from "vitest";
import { evaluateHarnessPolicy, parseHarnessPolicy } from "./policy";

const subject = { nodeType: "tool" as const, nodeId: "send", registryToolId: "crm.send", scope: "customer.write", risk: "high" as const };

describe("Harness 运行策略", () => {
  it("未配置时保留现有执行行为", () => {
    const policy = parseHarnessPolicy(undefined);
    expect(policy).not.toBeNull();
    expect(evaluateHarnessPolicy(policy!, subject)).toEqual({ allowed: true, ruleId: null, reason: null });
  });

  it("拒绝规则优先于允许规则，且只匹配明确指定的条件", () => {
    const policy = parseHarnessPolicy(JSON.stringify({ version: 1, rules: [
      { id: "allow-writes", effect: "allow", when: { scope: "customer.write" } },
      { id: "block-high-risk", effect: "deny", when: { nodeType: "tool", risk: "high" }, reason: "高风险操作暂不可执行" },
    ] }));
    expect(evaluateHarnessPolicy(policy!, subject)).toEqual({ allowed: false, ruleId: "block-high-risk", reason: "高风险操作暂不可执行" });
    expect(evaluateHarnessPolicy(policy!, { ...subject, risk: "low" })).toEqual({ allowed: true, ruleId: "allow-writes", reason: null });
  });

  it("错误配置、重复编号和未知字段均不接受", () => {
    expect(parseHarnessPolicy("{")).toBeNull();
    expect(parseHarnessPolicy(JSON.stringify({ version: 1, rules: [
      { id: "same", effect: "deny", when: {} }, { id: "same", effect: "allow", when: {} },
    ] }))).toBeNull();
    expect(parseHarnessPolicy(JSON.stringify({ version: 1, rules: [], unexpected: true }))).toBeNull();
  });
});
