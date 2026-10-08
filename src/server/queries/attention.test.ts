import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttentionListInput, type AttentionMetadata } from "@/contracts/attention";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { execute: mocks.execute } }));
import { listAttention } from "./attention";
const workspace = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const runId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const row: AttentionMetadata = { kind: "run-failed", id: runId, runId, agentId: null, agentName: null, agentNameTruncated: false,
  runStatus: "failed", title: "失败", titleTruncated: false, error: "apiKey=private-error", errorTruncated: false, createdAt: "2026-10-08T12:00:00.000123Z" };
beforeEach(() => { mocks.execute.mockReset(); });
describe("统一待处理有界查询", () => {
  it("一次数据库读取，不查询成果、输入、审批正文、备注或引擎句柄", async () => {
    mocks.execute.mockResolvedValue([row]);
    const result = await listAttention(workspace, AttentionListInput.parse({ limit: 1 }));
    expect(result).toMatchObject({ ok: true, items: [{ id: runId }], nextCursor: null });
    expect(JSON.stringify(result)).not.toContain("private-error");
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(query.sql).not.toMatch(/"(?:payload|receipt|input|context|step_states|workflow_run_id|note|resolutions|target_hash)"/);
    expect(query.sql).toContain('kind COLLATE "C"');
    expect(query.params.filter((value) => value === workspace)).toHaveLength(4);
    expect(query.params.at(-1)).toBe(2);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
  it("取一条额外记录判断下一页，游标保留微秒与类别", async () => {
    mocks.execute.mockResolvedValue([row, { ...row, kind: "tool-operation" }]);
    expect(await listAttention(workspace, AttentionListInput.parse({ limit: 1 }))).toMatchObject({ ok: true, nextCursor: { id: runId, kind: "run-failed", createdAt: row.createdAt } });
  });
  it("拒绝非法参数和坏数据库元数据，不返回部分成功清单", async () => {
    await expect(listAttention("bad", AttentionListInput.parse({}))).rejects.toThrow();
    expect(mocks.execute).not.toHaveBeenCalled();
    mocks.execute.mockResolvedValue([{ ...row, runStatus: "completed" }]);
    await expect(listAttention(workspace, AttentionListInput.parse({}))).rejects.toThrow();
  });
  it("参数化三个游标字段和来源筛选，不把输入拼入 SQL", async () => {
    mocks.execute.mockResolvedValue([]);
    await listAttention(workspace, AttentionListInput.parse({ before: row.createdAt, beforeId: runId.toUpperCase(), beforeKind: "tool-operation", kind: "tool-operation", runId }));
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(query.params).toEqual(expect.arrayContaining([row.createdAt, runId, "tool-operation"]));
    expect(query.sql).not.toContain(row.createdAt);
    expect(query.sql).toContain('kind COLLATE "C") <');
  });
});
