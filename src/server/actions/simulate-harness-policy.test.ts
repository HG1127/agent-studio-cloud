import { afterEach, describe, expect, it, vi } from "vitest";
import { simulateHarnessPolicyAction } from "./simulate-harness-policy";

afterEach(() => { vi.unstubAllEnvs(); });

describe("草稿规则试算可调用入口", () => {
  it("无需保存或启动运行，返回与当前管理员边界叠加后的判决", async () => {
    vi.stubEnv("HARNESS_POLICY_JSON", JSON.stringify({ version: 1, rules: [{ id: "deny", effect: "deny", when: { nodeType: "tool" } }] }));
    expect(await simulateHarnessPolicyAction({ policy: null, subjects: [{ nodeType: "tool", nodeId: "lookup" }] })).toMatchObject({
      ok: true, mode: "draft", decisions: [{ allowed: false, source: "administrator", matchedRuleIndex: null }],
    });
  });
  it("不能带保存标记或以试算入口开启真实执行", async () => {
    vi.stubEnv("HARNESS_POLICY_JSON", "");
    expect(await simulateHarnessPolicyAction({ policy: null, subjects: [{ nodeType: "ai", nodeId: "summarize" }], confirmed: true })).toEqual({
      ok: false, error: "运行规则或试算条件无效，请检查后重试",
    });
  });
});
