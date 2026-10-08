import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ transaction: vi.fn(), rows: vi.fn(), execute: vi.fn(), where: vi.fn(), selection: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { transaction: mocks.transaction, select: mocks.selection } }));
import { getExecutionResourcePolicy, listExecutionPolicyHistory } from "./execution-resources";
const workspace = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", now = new Date("2026-10-09T12:00:00Z");
const limits = { maxConcurrentChains: 2, maxModelCalls: 3, maxChildRuns: 1 };
const change = { id, requestId: id, revision: 2, previousLimits: limits, limits, reason: "试点 password=private-value", createdAt: now };
beforeEach(() => {
  vi.clearAllMocks(); mocks.rows.mockReset().mockResolvedValue([]); mocks.execute.mockReset().mockResolvedValue([{ reservedChains: "3", untrackedActiveRuns: "2" }]);
  mocks.selection.mockImplementation((fields: unknown) => { const query = { from: () => query, where: (value: unknown) => { mocks.where(value); return query; }, orderBy: () => query, limit: mocks.rows }; expect(fields).not.toHaveProperty("workspaceId"); return query; });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({ select: mocks.selection, execute: mocks.execute }));
});
describe("资源设置只读查询", () => {
  it("容量与设置来自同一个只读快照，默认设置不落库", async () => {
    const result = await getExecutionResourcePolicy(workspace, now); expect(result).toMatchObject({ policy: { source: "default", revision: 0 }, capacity: { reservedChains: 3, untrackedActiveRuns: 2, availableSlots: 47 } });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "repeatable read", accessMode: "read only" });
  });
  it("历史按版本分页、不读取哈希或创建人，原因再次隐藏凭据", async () => {
    mocks.rows.mockResolvedValue([change, { ...change, revision: 1 }]);
    const result = await listExecutionPolicyHistory(workspace, { limit: 1, beforeRevision: 3 });
    expect(result).toMatchObject({ ok: true, nextBeforeRevision: 2, items: [{ revision: 2 }] }); expect(JSON.stringify(result)).not.toContain("private-value");
    const fields = mocks.selection.mock.calls[0][0]; expect(fields).not.toHaveProperty("requestHash"); expect(fields).not.toHaveProperty("createdBy");
    const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]); expect(query.params).toEqual(expect.arrayContaining([workspace, 3])); expect(mocks.rows).toHaveBeenCalledWith(2);
  });
  it("损坏的资源或历史拒绝返回，不伪报默认或截断错误", async () => {
    mocks.rows.mockResolvedValue([{ id, revision: 1, limits: {}, updatedAt: now, archivedAt: null }]); await expect(getExecutionResourcePolicy(workspace, now)).rejects.toThrow();
    mocks.rows.mockResolvedValue([{ ...change, limits: {} }]); await expect(listExecutionPolicyHistory(workspace, { limit: 1 })).rejects.toThrow();
  });
});
