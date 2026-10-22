import { afterEach, describe, expect, it, vi } from "vitest";
import { simulateHarnessPolicyQuery } from "./simulate-harness-policy";

afterEach(() => { vi.unstubAllEnvs(); });
const input = { policy: null, subjects: [{ nodeType: "tool", nodeId: "lookup", scope: "customer.read" }] };

describe("策略试算只读入口", () => {
  it("未配置管理员规则沿用实际默认边界", async () => {
    vi.stubEnv("HARNESS_POLICY_JSON", "");
    expect(await simulateHarnessPolicyQuery(input)).toMatchObject({ ok: true, mode: "draft", decisions: [{ allowed: true }] });
  });
  it("读取当前管理员规则且不允许草稿放宽", async () => {
    vi.stubEnv("HARNESS_POLICY_JSON", JSON.stringify({ version: 1, rules: [{ id: "deny", effect: "deny", when: { scope: "customer.read" } }] }));
    expect(await simulateHarnessPolicyQuery(input)).toMatchObject({ ok: true, decisions: [{ allowed: false, source: "administrator" }] });
  });
  it("配置失效时返回阻止判决，未知输入返回固定错误", async () => {
    vi.stubEnv("HARNESS_POLICY_JSON", "invalid");
    expect(await simulateHarnessPolicyQuery(input)).toMatchObject({ ok: true, decisions: [{ allowed: false, invalid: true }] });
    expect(await simulateHarnessPolicyQuery({ ...input, runId: "not-a-run" })).toEqual({ ok: false, error: "运行规则或试算条件无效，请检查后重试" });
  });
});
