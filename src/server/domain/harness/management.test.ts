import { describe, expect, it } from "vitest";
import { HarnessPolicy } from "@/contracts/harness";
import { HarnessPolicyView } from "@/contracts/harness-management";
import {
  containsManagedHarnessCredential, evaluateFrozenHarnessPolicy, freezeWorkspaceHarnessPolicy, inheritHarnessPolicySnapshot,
  presentHarnessPolicy, readFrozenHarnessPolicy, validateManagedHarnessPolicy,
} from "./management";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const otherWorkspace = "00000000-0000-4000-8000-000000000002";
const now = new Date("2026-10-12T00:00:00.000Z");
const empty = HarnessPolicy.parse({ version: 1, rules: [] });
const deny = HarnessPolicy.parse({ version: 1, rules: [{ id: "deny", effect: "deny", when: { scope: "customer.write" } }] });
const allow = HarnessPolicy.parse({ version: 1, rules: [{ id: "allow", effect: "allow", when: {} }] });
const subject = { nodeType: "tool" as const, nodeId: "tools.write", scope: "customer.write", risk: "high" as const };
const view = HarnessPolicyView.parse({ revision: 1, source: "configured", policy: deny, updatedAt: now.toISOString() });
const snapshot = freezeWorkspaceHarnessPolicy(workspaceId, view, now);

describe("持久规则纯域边界", () => {
  it("未配置与明确清空保留不同版本", () => {
    expect(presentHarnessPolicy(null)).toMatchObject({ source: "unconfigured", revision: 0 });
    expect(presentHarnessPolicy({ id: workspaceId, revision: 2, policy: null, updatedAt: now, archivedAt: null })).toMatchObject({ source: "cleared", revision: 2 });
  });
  it("冻结与继承是独立副本，不采用后来修改", () => {
    const mutable = HarnessPolicyView.parse(view);
    const frozen = freezeWorkspaceHarnessPolicy(workspaceId, mutable, now);
    mutable.policy!.rules.length = 0;
    expect(frozen.policy!.rules).toHaveLength(1);
    const child = inheritHarnessPolicySnapshot(workspaceId, { workspaceId, snapshot: frozen });
    expect(child).toEqual(frozen); expect(child).not.toBe(frozen);
    frozen.policy!.rules.length = 0;
    expect(child!.policy!.rules).toHaveLength(1);
  });
  it("历史空快照与后代只保留管理员规则，不猜当前配置", () => {
    expect(readFrozenHarnessPolicy(workspaceId, null)).toBeNull();
    expect(inheritHarnessPolicySnapshot(workspaceId, { workspaceId, snapshot: null })).toBeNull();
    expect(evaluateFrozenHarnessPolicy({ administrator: empty, workspaceId, snapshot: null, subject })).toEqual({ allowed: true, source: "legacy", invalid: false });
  });
  it("管理员非法或拒绝不被管理允许覆盖", () => {
    const managedAllow = freezeWorkspaceHarnessPolicy(workspaceId, { ...view, policy: allow }, now);
    expect(evaluateFrozenHarnessPolicy({ administrator: null, workspaceId, snapshot: managedAllow, subject })).toEqual({ allowed: false, source: "administrator", invalid: true });
    expect(evaluateFrozenHarnessPolicy({ administrator: deny, workspaceId, snapshot: managedAllow, subject })).toEqual({ allowed: false, source: "administrator", invalid: false });
  });
  it("管理拒绝生效，但保持精确条件而非通配符", () => {
    expect(evaluateFrozenHarnessPolicy({ administrator: allow, workspaceId, snapshot, subject })).toMatchObject({ allowed: false, source: "workspace" });
    expect(evaluateFrozenHarnessPolicy({ administrator: empty, workspaceId, snapshot, subject: { ...subject, scope: "customer.read" } }).allowed).toBe(true);
    const glob = freezeWorkspaceHarnessPolicy(workspaceId, { ...view, policy: { version: 1, rules: [{ id: "literal", effect: "deny", when: { scope: "customer.*" } }] } }, now);
    expect(evaluateFrozenHarnessPolicy({ administrator: empty, workspaceId, snapshot: glob, subject }).allowed).toBe(true);
  });
  it("缺父、跨工作区、非法冻结或归档内容关闭调用", () => {
    expect(() => inheritHarnessPolicySnapshot(workspaceId, null)).toThrow();
    expect(() => inheritHarnessPolicySnapshot(workspaceId, { workspaceId: otherWorkspace, snapshot })).toThrow();
    for (const raw of [undefined, {}, { ...snapshot, workspaceId: otherWorkspace }, { ...snapshot, revision: -1 }]) {
      expect(evaluateFrozenHarnessPolicy({ administrator: empty, workspaceId, snapshot: raw, subject })).toMatchObject({ allowed: false, invalid: true });
    }
    expect(() => presentHarnessPolicy({ id: workspaceId, revision: 1, policy: empty, updatedAt: now, archivedAt: now })).toThrow();
    expect(() => freezeWorkspaceHarnessPolicy(workspaceId, view, new Date("invalid"))).toThrow();
  });
  it("凭据字面量拒绝而不改变普通业务匹配", () => {
    expect(validateManagedHarnessPolicy({ version: 1, rules: [{ id: "mail", effect: "deny", when: { scope: "customer@example.com" } }] })).not.toBeNull();
    for (const value of ["Bearer abcdefghijklmnop", "sk-abcdefghijklmnop", "password=private-password"]) {
      expect(() => validateManagedHarnessPolicy({ version: 1, rules: [{ id: "deny", effect: "deny", when: { scope: value } }] })).toThrow();
      expect(() => validateManagedHarnessPolicy({ version: 1, rules: [{ id: "deny", effect: "deny", when: {}, reason: value }] })).toThrow();
    }
  });
  it("裸公开工具凭据在所有自由字符串字段拒绝，不能流入冻结规则", () => {
    const credential = `pat_${"a".repeat(64)}`;
    expect(containsManagedHarnessCredential(credential)).toBe(true);
    expect(containsManagedHarnessCredential(`确认 ${credential}`)).toBe(true);
    expect(containsManagedHarnessCredential("pat_business_label")).toBe(false);
    const rules = [
      { id: credential, effect: "deny", when: {} }, { id: "deny", effect: "deny", when: {}, reason: credential },
      ...["nodeId", "registryToolId", "scope"].map((field) => ({ id: "deny", effect: "deny", when: { [field]: credential } })),
    ];
    for (const rule of rules) {
      expect(() => validateManagedHarnessPolicy({ version: 1, rules: [rule] })).toThrow();
      expect(evaluateFrozenHarnessPolicy({ administrator: empty, workspaceId, snapshot: { ...snapshot, policy: { version: 1, rules: [rule] } }, subject })).toMatchObject({ allowed: false, invalid: true });
    }
  });
});
