import { describe, expect, it, vi } from "vitest";
import {
  HarnessManagedPolicy, HarnessPolicySaveInput, HarnessPolicySaveResult, HarnessPolicySnapshot, HarnessPolicyView,
} from "./harness-management";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const policy = { version: 1, rules: [{ id: "deny-write", effect: "deny", when: { nodeType: "tool", risk: "high" } }] };
const input = { requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expectedRevision: 0, confirmed: true, policy, reason: "限制高风险工具" };

describe("运行规则管理共享契约", () => {
  it("明确 null 清空，空数组仍是有效配置", () => {
    expect(HarnessPolicySaveInput.parse({ ...input, policy: null }).policy).toBeNull();
    expect(HarnessManagedPolicy.parse({ version: 1, rules: [] })).toEqual({ version: 1, rules: [] });
    const withoutPolicy: Partial<typeof input> = { ...input };
    delete withoutPolicy.policy;
    expect(HarnessPolicySaveInput.safeParse(withoutPolicy).success).toBe(false);
  });
  it.each([
    { ...input, workspaceId: workspaceId }, { ...input, createdBy: workspaceId }, { ...input, confirmed: false },
    { ...input, expectedRevision: -1 }, { ...input, expectedRevision: 2_147_483_647 },
  ])("身份、确认与版本无效时拒绝请求", (raw) => { expect(HarnessPolicySaveInput.safeParse(raw).success).toBe(false); });
  it.each([
    { version: 1, rules: [{ id: "old", effect: "require_approval", when: {} }] },
    { version: 1, rules: [{ id: "old", effect: "observe", when: {} }] },
    { version: 1, rules: [{ id: "old", effect: "deny", when: { scope: ["read"] } }] },
    { version: 1, rules: [{ id: "old", effect: "deny", priority: 10, when: {} }] },
    { version: 1, rules: [{ id: "same", effect: "deny", when: {} }, { id: "same", effect: "allow", when: {} }] },
  ])("不静默转换旧系统或重复规则", (raw) => { expect(HarnessManagedPolicy.safeParse(raw).success).toBe(false); });
  it("访问器和序列化钩子不执行", () => {
    const getter = vi.fn();
    expect(HarnessPolicySaveInput.safeParse({ ...input, get reason() { getter(); return "原因"; } }).success).toBe(false);
    expect(HarnessPolicySnapshot.safeParse({ version: 1, workspaceId, revision: 0, policy: null, get frozenAt() { getter(); return "2026-10-12T00:00:00.000Z"; } }).success).toBe(false);
    expect(HarnessManagedPolicy.safeParse({ version: 1, rules: [], toJSON: getter }).success).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });
  it("按 UTF-8 总量拒绝合法长度但组合超限的规则，不截断", () => {
    const raw = { version: 1, rules: Array.from({ length: 100 }, (_, index) => ({ id: `${index}${"中".repeat(95)}`, effect: "deny", reason: "中".repeat(300),
      when: { nodeType: "tool", nodeId: "中".repeat(200), registryToolId: "中".repeat(200), scope: "中".repeat(200), risk: "high" } })) };
    expect(HarnessManagedPolicy.safeParse(raw).success).toBe(false); expect(raw.rules).toHaveLength(100);
  });
  it("状态、冻结版本和回执一致", () => {
    expect(HarnessPolicyView.safeParse({ revision: 0, source: "cleared", policy: null, updatedAt: null }).success).toBe(false);
    expect(HarnessPolicySnapshot.safeParse({ version: 1, workspaceId, revision: 0, policy, frozenAt: "2026-10-12T00:00:00.000Z" }).success).toBe(false);
    expect(HarnessPolicySaveResult.safeParse({ ok: false, error: "冲突", conflict: true, retryable: true }).success).toBe(false);
    expect(HarnessPolicySaveResult.safeParse({ ok: true, recordedRevision: 2, policy: { revision: 1, source: "configured", policy, updatedAt: "2026-10-12T00:00:00.000Z" } }).success).toBe(false);
  });
});
