import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttentionCaseListInput } from "@/contracts/attention-handling";
import { attentionCases } from "@/db/schema";
const mocks = vi.hoisted(() => ({ select: vi.fn(), where: vi.fn(), limit: vi.fn(), current: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { select: mocks.select } }));
vi.mock("./attention", () => ({ findCurrentAttention: mocks.current }));
import { getAttentionCase, listAttentionCases, presentAttentionCase } from "./attention-cases";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const workspaceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const now = new Date("2026-10-09T00:00:00Z");
const row: typeof attentionCases.$inferSelect = { id, workspaceId, createdBy: id, kind: "run-failed", sourceId: id, runId: id, occurrence: "saved:failure", title: "apiKey=abc 任务失败", status: "in-progress", revision: 1, createdAt: now, updatedAt: now, closedAt: null, archivedAt: null,
  entries: [{ requestId: id, requestHash: "a".repeat(64), action: "note", reason: "密码：abc", createdBy: id, createdAt: now.toISOString() }] };
beforeEach(() => {
  vi.clearAllMocks(); mocks.current.mockResolvedValue({ kind: row.kind, id, runId: id, occurrence: row.occurrence });
  const chain = { from: vi.fn(), where: mocks.where, orderBy: vi.fn(), limit: mocks.limit };
  chain.from.mockReturnValue(chain); chain.where.mockReturnValue(chain); chain.orderBy.mockReturnValue(chain);
  mocks.select.mockReturnValue(chain); mocks.limit.mockResolvedValue([]);
});
describe("处理历史查询与隐私边界", () => {
  it("详情仅返回公开历史，凭据重新脱敏，来源仍按原工作区核对", async () => {
    const result = await presentAttentionCase(row);
    expect(result).toMatchObject({ sourceState: "active", revision: 1, entries: [{ requestId: id }] });
    expect(JSON.stringify(result)).not.toMatch(/apiKey=abc|密码：abc|requestHash/);
    expect(mocks.current).toHaveBeenCalledWith(workspaceId, result.reference, expect.anything());
  });
  it.each([null, { kind: "run-failed", id, runId: id, occurrence: "next:failure" }])("来源消失或换代时不冒充仍在处理原事项", async (current) => {
    mocks.current.mockResolvedValue(current);
    expect((await presentAttentionCase(row)).sourceState).toBe(current ? "changed" : "inactive");
  });
  it("坏历史不返回部分详情，非法任务归属在来源查询前拒绝", async () => {
    await expect(presentAttentionCase({ ...row, revision: 2 })).rejects.toThrow();
    mocks.current.mockClear();
    await expect(presentAttentionCase({ ...row, runId: workspaceId })).rejects.toThrow();
    expect(mocks.current).not.toHaveBeenCalled();
  });
  it("无效标识不访问数据库，缺失或另一工作区记录不返回详情", async () => {
    await expect(getAttentionCase("bad", id)).rejects.toThrow();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(await getAttentionCase(workspaceId, id)).toBeNull();
    const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]);
    expect(query.params).toEqual(expect.arrayContaining([workspaceId, id]));
    expect(mocks.current).not.toHaveBeenCalled();
  });
  it("列表只选历史条数，来源和状态筛选使用参数，游标保留微秒", async () => {
    const createdAt = "2026-10-09T00:00:00.000123Z";
    mocks.limit.mockResolvedValue([{ ...row, createdAt, entryCount: 1 }, { ...row, id: workspaceId, createdAt, entryCount: 1 }]);
    const result = await listAttentionCases(workspaceId, AttentionCaseListInput.parse({ status: "in-progress", runId: id, kind: "run-failed", limit: 1, before: createdAt, beforeId: id }));
    expect(result.nextCursor).toEqual({ createdAt, id });
    expect(JSON.stringify(result)).not.toMatch(/entries|requestHash|密码：abc/);
    const selection = mocks.select.mock.calls[0][0];
    expect(Object.keys(selection)).not.toContain("entries");
    expect(new PgDialect().sqlToQuery(selection.entryCount).sql).toBe('jsonb_array_length("attention_cases"."entries")');
    expect(new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]).params).toEqual(expect.arrayContaining([workspaceId, id, "in-progress", "run-failed", createdAt]));
    expect(mocks.limit).toHaveBeenCalledExactlyOnceWith(2);
    expect(mocks.current).not.toHaveBeenCalled();
  });
});
