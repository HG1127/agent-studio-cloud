import { describe, expect, it, vi } from "vitest";
import { HarnessSimulationDecision, HarnessSimulationInput, HarnessSimulationResult } from "./harness-simulation";

const subject = { nodeType: "tool", nodeId: "lookup", scope: "customer.read" };
const input = { policy: null, subjects: [subject] };
const decision = { subjectIndex: 0, allowed: true, invalid: false, source: "workspace", matchedRuleIndex: null };

describe("运行策略试算契约", () => {
  it("接受未保存草稿和空规则，不要求运行或保存标识", () => {
    expect(HarnessSimulationInput.parse(input)).toEqual(input);
    expect(HarnessSimulationInput.safeParse({ ...input, policy: { version: 1, rules: [] } }).success).toBe(true);
  });
  it.each([{ subjects: [] }, { subjects: Array.from({ length: 51 }, () => subject) }])("试算条件数量必须在边界内", ({ subjects }) => {
    expect(HarnessSimulationInput.safeParse({ ...input, subjects }).success).toBe(false);
  });
  it("接受恰好五十条完整条件", () => {
    expect(HarnessSimulationInput.safeParse({ ...input, subjects: Array.from({ length: 50 }, () => subject) }).success).toBe(true);
  });
  it("拒绝未知条件和模拟生效字段", () => {
    expect(HarnessSimulationInput.safeParse({ ...input, confirmed: true }).success).toBe(false);
    expect(HarnessSimulationInput.safeParse({ ...input, subjects: [{ ...subject, protocol: "mcp" }] }).success).toBe(false);
    expect(HarnessSimulationInput.safeParse({ ...input, subjects: [{ ...subject, nodeId: "" }] }).success).toBe(false);
    expect(HarnessSimulationInput.safeParse({ ...input, subjects: [{ ...subject, scope: "x".repeat(201) }] }).success).toBe(false);
  });
  it("不执行访问器，也不接受循环或超限数据", () => {
    const getter = vi.fn();
    expect(HarnessSimulationInput.safeParse({ ...input, get policy() { getter(); return null; } }).success).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    const cyclic: Record<string, unknown> = { subjects: [subject] }; cyclic.policy = cyclic;
    expect(HarnessSimulationInput.safeParse(cyclic).success).toBe(false);
    expect(HarnessSimulationInput.safeParse({ ...input, extra: "x".repeat(400_000) }).success).toBe(false);
  });
  it("管理员判决不返回其私有命中位置，无效配置不能放行", () => {
    expect(HarnessSimulationDecision.safeParse({ ...decision, source: "administrator", matchedRuleIndex: 0 }).success).toBe(false);
    expect(HarnessSimulationDecision.safeParse({ ...decision, invalid: true }).success).toBe(false);
    expect(HarnessSimulationDecision.safeParse({ ...decision, invalid: true, allowed: false, matchedRuleIndex: 0 }).success).toBe(false);
  });
  it("只允许草稿确定性覆盖，不伪称已保存或真实执行", () => {
    const result = { ok: true, mode: "draft", coverage: "deterministic-rules-only", decisions: [decision] };
    expect(HarnessSimulationResult.parse(result)).toEqual(result);
    expect(HarnessSimulationResult.safeParse({ ...result, mode: "applied" }).success).toBe(false);
    expect(HarnessSimulationResult.safeParse({ ...result, executed: true }).success).toBe(false);
    expect(HarnessSimulationResult.safeParse({ ...result, decisions: [{ ...decision, subjectIndex: 1 }] }).success).toBe(false);
    expect(HarnessSimulationResult.safeParse({ ...result, decisions: [decision, decision] }).success).toBe(false);
  });
});
