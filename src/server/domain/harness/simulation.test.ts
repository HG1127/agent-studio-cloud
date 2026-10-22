import { describe, expect, it } from "vitest";
import { HarnessPolicy } from "@/contracts/harness";
import { HarnessPolicySnapshot } from "@/contracts/harness-management";
import { evaluateFrozenHarnessPolicy } from "./management";
import { simulateHarnessPolicy } from "./simulation";

const empty = HarnessPolicy.parse({ version: 1, rules: [] });
const subject = { nodeType: "tool" as const, nodeId: "lookup", registryToolId: "customer.lookup", scope: "customer.read", risk: "low" as const };
const deny = HarnessPolicy.parse({ version: 1, rules: [{ id: "read", effect: "deny", when: { scope: "customer.read" } }] });
const allow = HarnessPolicy.parse({ version: 1, rules: [{ id: "allow", effect: "allow", when: {} }] });
const workspaceId = "11111111-1111-4111-8111-111111111111";

describe("草稿运行策略确定性试算", () => {
  it("命中顺序与拒绝优先复用实际策略匹配", () => {
    const result = simulateHarnessPolicy({ policy: { version: 1, rules: [
      { id: "allow", effect: "allow", when: { risk: "low" } },
      { id: "deny", effect: "deny", when: { nodeType: "tool", scope: "customer.read" } },
    ] }, subjects: [subject, { ...subject, scope: "other" }] }, empty);
    expect(result).toMatchObject({ ok: true, decisions: [
      { subjectIndex: 0, allowed: false, source: "workspace", matchedRuleIndex: 1 },
      { subjectIndex: 1, allowed: true, source: "workspace", matchedRuleIndex: 0 },
    ] });
  });
  it("工作区允许不能覆盖管理员拒绝，管理员原因和编号不会输出", () => {
    const privatePolicy = HarnessPolicy.parse({ version: 1, rules: [{ id: "private-admin", effect: "deny", when: {}, reason: "internal-only" }] });
    const result = simulateHarnessPolicy({ policy: allow, subjects: [subject] }, privatePolicy);
    expect(result).toMatchObject({ ok: true, decisions: [{ allowed: false, invalid: false, source: "administrator", matchedRuleIndex: null }] });
    expect(JSON.stringify(result)).not.toMatch(/private-admin|internal-only|customer.read|customer.lookup/);
  });
  it("管理员配置无效时关闭试算放行", () => {
    expect(simulateHarnessPolicy({ policy: allow, subjects: [subject] }, null)).toMatchObject({
      ok: true, decisions: [{ allowed: false, invalid: true, source: "administrator", matchedRuleIndex: null }],
    });
  });
  it("清空工作区规则保留管理员边界，不修改草稿", () => {
    const input = { policy: null, subjects: [subject] };
    expect(simulateHarnessPolicy(input, empty)).toMatchObject({ ok: true, decisions: [{ allowed: true, matchedRuleIndex: null }] });
    expect(simulateHarnessPolicy(input, deny)).toMatchObject({ ok: true, decisions: [{ allowed: false, source: "administrator" }] });
    expect(input).toEqual({ policy: null, subjects: [subject] });
  });
  it("所有返回判决与运行冻结规则的实际 allowed/source/invalid 相同", () => {
    for (const administrator of [empty, allow, deny, null]) {
      for (const policy of [empty, allow, deny, null]) {
        const snapshot = HarnessPolicySnapshot.parse({ version: 1, workspaceId, revision: 1, policy, frozenAt: "2026-10-12T00:00:00.000Z" });
        const subjects = [subject, { ...subject, scope: "other" }, { nodeType: "ai" as const, nodeId: "summarize" }];
        const result = simulateHarnessPolicy({ policy, subjects }, administrator);
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error("试算未返回判决");
        result.decisions.forEach((decision, index) => {
          const actual = evaluateFrozenHarnessPolicy({ administrator, workspaceId, snapshot, subject: subjects[index] });
          expect({ allowed: decision.allowed, invalid: decision.invalid, source: decision.source }).toEqual(actual);
        });
      }
    }
  });
  it("使用精确条件，不将通配文本或空值改成宽松匹配", () => {
    const policy = { version: 1, rules: [{ id: "literal", effect: "deny", when: { scope: "customer.*" } }] };
    expect(simulateHarnessPolicy({ policy, subjects: [subject, { ...subject, scope: null }] }, empty)).toMatchObject({
      ok: true, decisions: [{ allowed: true }, { allowed: true }],
    });
  });
  it("含调用凭据的规则和条件不能进入试算", () => {
    const token = `pat_${"a".repeat(64)}`;
    expect(simulateHarnessPolicy({ policy: { version: 1, rules: [{ id: "secret", effect: "deny", when: {}, reason: token }] }, subjects: [subject] }, empty).ok).toBe(false);
    const result = simulateHarnessPolicy({ policy: empty, subjects: [{ ...subject, scope: token }] }, empty);
    expect(result.ok).toBe(false); expect(JSON.stringify(result)).not.toContain(token);
  });
  it("非法草稿不会回退成放行，拒绝重号和未知条件", () => {
    for (const policy of [{ version: 2, rules: [] }, { version: 1, rules: ["same", "same"].map((id) => ({ id, effect: "allow", when: {} })) },
      { version: 1, rules: [{ id: "x", effect: "allow", when: { protocol: "mcp" } }] }]) {
      expect(simulateHarnessPolicy({ policy, subjects: [subject] }, empty).ok).toBe(false);
    }
  });
});
