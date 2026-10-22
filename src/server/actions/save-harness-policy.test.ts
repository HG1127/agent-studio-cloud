import { createHash } from "node:crypto";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HarnessPolicySaveInput } from "@/contracts/harness-management";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { canonicalJson } from "@/server/domain/canonical-json";

const mocks = vi.hoisted(() => ({
  rows: vi.fn(), returning: vi.fn(), execute: vi.fn(), transaction: vi.fn(),
  inserts: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  updates: [] as Record<string, unknown>[], filters: [] as SQL[],
}));
vi.mock("@/lib/db", () => {
  const client = {
    execute: mocks.execute,
    select: () => {
      const query = { from: () => query, where: (filter: SQL) => { mocks.filters.push(filter); return query; }, for: () => query, limit: mocks.rows };
      return query;
    },
    insert: (table: unknown) => ({ values: (values: Record<string, unknown>) => {
      mocks.inserts.push({ table, values }); return { returning: mocks.returning };
    } }),
    update: () => ({ set: (values: Record<string, unknown>) => {
      mocks.updates.push(values); return { where: (filter: SQL) => { mocks.filters.push(filter); return { returning: mocks.returning }; } };
    } }),
  };
  mocks.transaction.mockImplementation((callback: (tx: typeof client) => unknown) => callback(client));
  return { db: { ...client, transaction: mocks.transaction } };
});
import { harnessPolicies, harnessPolicyChanges } from "@/db/schema";
import { saveHarnessPolicyAction } from "./save-harness-policy";
const policy = { version: 1 as const, rules: [{ id: "deny-write", effect: "deny" as const, when: { nodeType: "tool" as const } }] };
const input = { requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expectedRevision: 0, confirmed: true as const, policy, reason: "试点规则" };
const rowId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const row = (revision = 1) => ({ id: rowId, revision, policy, updatedAt: new Date("2026-10-12T00:00:00Z"), archivedAt: null });
beforeEach(() => {
  vi.clearAllMocks(); mocks.rows.mockReset().mockResolvedValue([]); mocks.returning.mockReset().mockResolvedValue([{ id: rowId }]);
  mocks.execute.mockReset().mockResolvedValue([]); mocks.inserts = []; mocks.updates = []; mocks.filters = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("运行规则 Server Action 与事务防重", () => {
  it("非法确认、伪造身份与凭据不进入数据库", async () => {
    for (const raw of [{ ...input, confirmed: false }, { ...input, workspaceId: rowId }, { ...input, createdBy: rowId },
      { ...input, reason: "password=private-password" }, { ...input, reason: `pat_${"a".repeat(64)}` },
      { ...input, policy: { version: 1, rules: [{ id: "x", effect: "deny", when: { scope: "sk-abcdefghijklmnop" } }] } }]) {
      expect(await saveHarnessPolicyAction(raw as typeof input)).toMatchObject({ ok: false });
    }
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("首次保存当前配置与追加账本使用服务端身份及同一事务", async () => {
    const result = await saveHarnessPolicyAction(input);
    expect(result).toMatchObject({ ok: true, recordedRevision: 1, policy: { revision: 1, source: "configured", policy } });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.inserts).toHaveLength(2);
    expect(mocks.inserts[0].table).toBe(harnessPolicies);
    expect(mocks.inserts[0].values).toMatchObject({ workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, revision: 1, policy });
    expect(mocks.inserts[1].table).toBe(harnessPolicyChanges);
    expect(mocks.inserts[1].values).toMatchObject({ workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, policyId: rowId, requestId: input.requestId, revision: 1, previousPolicy: null, policy });
    const lock = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(lock.params).toContain(`harness-policy:${DEMO_WORKSPACE_ID}`);
    for (const filter of mocks.filters) expect(new PgDialect().sqlToQuery(filter).params).toContain(DEMO_WORKSPACE_ID);
  });
  it("清空是版本更新和追加记录，不删除旧记录", async () => {
    mocks.rows.mockResolvedValueOnce([row()]).mockResolvedValueOnce([]);
    expect(await saveHarnessPolicyAction({ ...input, expectedRevision: 1, policy: null })).toMatchObject({ ok: true, recordedRevision: 2, policy: { revision: 2, source: "cleared", policy: null } });
    expect(mocks.updates[0]).toMatchObject({ revision: 2, policy: null });
    expect(mocks.inserts[0].table).toBe(harnessPolicyChanges);
    expect(mocks.inserts[0].values).toMatchObject({ previousPolicy: policy, policy: null, revision: 2 });
    const cas = new PgDialect().sqlToQuery(mocks.filters.at(-1)!);
    expect(cas.params).toEqual(expect.arrayContaining([DEMO_WORKSPACE_ID, rowId, 1]));
  });
  it("并发版本冲突不修改当前配置或账本", async () => {
    mocks.rows.mockResolvedValueOnce([row(2)]).mockResolvedValueOnce([]);
    expect(await saveHarnessPolicyAction(input)).toMatchObject({ ok: false, conflict: true });
    expect(mocks.inserts).toHaveLength(0); expect(mocks.updates).toHaveLength(0);
  });
  it("CAS 未命中不追加成功记录", async () => {
    mocks.rows.mockResolvedValueOnce([row()]).mockResolvedValueOnce([]); mocks.returning.mockResolvedValue([]);
    expect(await saveHarnessPolicyAction({ ...input, expectedRevision: 1 })).toMatchObject({ ok: false, conflict: true });
    expect(mocks.inserts).toHaveLength(0);
  });
  it("同请求在后来版本仍找回原版本，不再次写入", async () => {
    const requestHash = createHash("sha256").update(canonicalJson(HarnessPolicySaveInput.parse(input))).digest("hex");
    mocks.rows.mockResolvedValueOnce([row(3)]).mockResolvedValueOnce([{ requestHash, revision: 1 }]);
    expect(await saveHarnessPolicyAction(input)).toMatchObject({ ok: true, recordedRevision: 1, policy: { revision: 3 } });
    expect(mocks.inserts).toHaveLength(0); expect(mocks.updates).toHaveLength(0);
  });
  it("同请求更换内容即使版本相同也拒绝", async () => {
    mocks.rows.mockResolvedValueOnce([row()]).mockResolvedValueOnce([{ requestHash: "different", revision: 1 }]);
    expect(await saveHarnessPolicyAction(input)).toMatchObject({ ok: false, conflict: true });
    expect(mocks.inserts).toHaveLength(0); expect(mocks.updates).toHaveLength(0);
  });
  it("数据库未知结果沿用原请求重试且不返回原始错误", async () => {
    mocks.transaction.mockRejectedValueOnce(new Error("postgres://operator:private-password@db.example"));
    const result = await saveHarnessPolicyAction(input);
    expect(result).toMatchObject({ ok: false, retryable: true }); expect(JSON.stringify(result)).not.toContain("private-password");
  });
  it("损坏或归档配置不作为空配置覆盖", async () => {
    mocks.rows.mockResolvedValueOnce([{ ...row(), archivedAt: new Date() }]);
    expect(await saveHarnessPolicyAction(input)).toMatchObject({ ok: false });
    expect(mocks.inserts).toHaveLength(0); expect(mocks.updates).toHaveLength(0);
  });
});
