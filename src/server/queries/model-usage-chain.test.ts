import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rows: vi.fn(), execute: vi.fn(), where: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { transaction: mocks.transaction } }));
import { getRunModelUsageChain } from "./model-usage-chain";
const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", c = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", workspace = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const now = new Date("2026-10-09T12:00:00Z");
const root = { runId: a, parentRunId: null, sourceType: "manual", sourceKey: null, status: "completed", collaborationTrackingVersion: "v1" };
const child = (id: string) => ({ ...root, runId: id, parentRunId: a, sourceType: "agent_call", sourceKey: `agent-call:${a}:step` });
const aggregate = (runId: string) => ({ runId, trackingVersion: "v1", calls: "0", pending: "0", returned: "0", failed: "0", completeCalls: "0", invalidUsageCalls: "0", inputCalls: "0", outputCalls: "0", knownInputTokens: null, knownOutputTokens: null, knownCallTotalTokens: null });
beforeEach(() => {
  vi.clearAllMocks(); mocks.rows.mockReset().mockResolvedValue([]); mocks.execute.mockReset().mockResolvedValue([aggregate(a)]);
  const selection = { from: () => ({ where: (value: unknown) => { mocks.where(value); return { limit: mocks.rows, orderBy: () => ({ limit: mocks.rows }) }; } }) };
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({ select: () => selection, execute: mocks.execute }));
});
describe("执行链只读快照查询", () => {
  it("单个根在可重复读只读事务内查询，只选必要元数据且未知用量不置零", async () => {
    mocks.rows.mockResolvedValueOnce([root]).mockResolvedValueOnce([]);
    expect(await getRunModelUsageChain(workspace, a, now)).toMatchObject({ rootRunId: a, graph: { includedRuns: 1, complete: true }, usage: { knownCallTotalTokens: null, recordedUsageComplete: true } });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "repeatable read", accessMode: "read only" });
    for (const [where] of mocks.where.mock.calls) { const query = new PgDialect().sqlToQuery(where); expect(query.params).toContain(workspace); expect(query.sql).not.toContain(workspace); }
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(query.sql).not.toMatch(/"(?:input|output|context|result|error|workflow_run_id|step_states)"|run_steps/);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
  it("从子运行返回同根的兄弟，祖先和后代只纳入一次，批量一次汇总", async () => {
    mocks.rows.mockResolvedValueOnce([child(b)]).mockResolvedValueOnce([root]).mockResolvedValueOnce([child(b), child(c)]).mockResolvedValueOnce([]);
    mocks.execute.mockResolvedValue([aggregate(a), aggregate(b), aggregate(c)]);
    const result = await getRunModelUsageChain(workspace, b.toUpperCase(), now);
    expect(result).toMatchObject({ requestedRunId: b, rootRunId: a, graph: { includedRuns: 3, cycleDetected: false, complete: true } });
    expect(result!.runs.map((run) => run.summary.runId)).toEqual([a, b, c]); expect(mocks.execute).toHaveBeenCalledTimes(1);
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]); expect(query.params).toEqual(expect.arrayContaining([a, b, c, workspace]));
  });
  it("找不到祖先保留本地锚点，不存在原运行返回空；缺失或混入的汇总拒绝", async () => {
    mocks.rows.mockResolvedValueOnce([child(b)]).mockResolvedValueOnce([]).mockResolvedValueOnce([]); mocks.execute.mockResolvedValue([aggregate(b)]);
    expect(await getRunModelUsageChain(workspace, b, now)).toMatchObject({ anchorRunId: b, rootRunId: null, graph: { missingParent: true, complete: false } });
    mocks.rows.mockResolvedValue([]); expect(await getRunModelUsageChain(workspace, a, now)).toBeNull();
    mocks.rows.mockResolvedValueOnce([root]).mockResolvedValueOnce([]); mocks.execute.mockResolvedValue([]);
    await expect(getRunModelUsageChain(workspace, a, now)).rejects.toThrow("不完整");
    mocks.rows.mockResolvedValueOnce([root]).mockResolvedValueOnce([]); mocks.execute.mockResolvedValue([aggregate(b)]);
    await expect(getRunModelUsageChain(workspace, a, now)).rejects.toThrow("范围不一致");
  });
  it("环在祖先和后代遍历中均有界，汇总不重复也不虚构根", async () => {
    const cyclicRoot = { ...root, parentRunId: b, sourceType: "handoff", sourceKey: `handoff:${b}:loop` };
    mocks.rows.mockResolvedValueOnce([cyclicRoot]).mockResolvedValueOnce([child(b)])
      .mockResolvedValueOnce([cyclicRoot]).mockResolvedValueOnce([child(b)]);
    mocks.execute.mockResolvedValue([aggregate(a), aggregate(b)]);
    const result = await getRunModelUsageChain(workspace, a, now);
    expect(result).toMatchObject({ requestedRunId: a, anchorRunId: b, rootRunId: null, graph: { includedRuns: 2, cycleDetected: true, complete: false } });
    expect(mocks.rows).toHaveBeenCalledTimes(4);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("宽分支截断仍保留未出现在查询首页的原请求路径，读取和纳入数量有界", async () => {
    const requested = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const children = Array.from({ length: 201 }, (_, index) => child(`10000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`));
    mocks.rows.mockResolvedValueOnce([child(requested)]).mockResolvedValueOnce([root])
      .mockResolvedValueOnce(children).mockResolvedValueOnce([]);
    mocks.execute.mockResolvedValue([aggregate(a), aggregate(requested), ...children.slice(0, 198).map((row) => aggregate(row.runId))]);
    const result = await getRunModelUsageChain(workspace, requested, now);
    expect(result).toMatchObject({ requestedRunId: requested, rootRunId: a, graph: { includedRuns: 200, truncated: true, complete: false }, usage: { recordedUsageComplete: false } });
    expect(result!.runs.some((run) => run.summary.runId === requested)).toBe(true);
    expect(mocks.rows.mock.calls.map(([limit]) => limit)).toEqual([1, 1, 201, 201]);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("非法工作区、任务或时刻在事务前拒绝", async () => {
    await expect(getRunModelUsageChain("bad", a, now)).rejects.toThrow(); await expect(getRunModelUsageChain(workspace, "bad", now)).rejects.toThrow();
    await expect(getRunModelUsageChain(workspace, a, new Date("bad"))).rejects.toThrow(); expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
