import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FatalError } from "workflow";
const mocks = vi.hoisted(() => ({ graph: vi.fn(), rows: vi.fn(), execute: vi.fn(), update: vi.fn(), where: vi.fn(), locks: vi.fn() }));
vi.mock("./execution-chain-graph", () => ({ readExecutionChainGraph: mocks.graph }));
import { enforceChildRunResourceLimit, enforceModelCallResourceLimit, lockExecutionWorkspace, prepareExecutionResourceScope, readExecutionCapacity, reserveRootExecutionResources, ExecutionResourceRejected } from "./execution-resources";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", child = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", workspace = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const snapshot = { version: "v1" as const, policyRevision: 0, limits: { maxModelCalls: 1, maxChildRuns: 1 }, coverage: "new-root" as const, frozenAt: "2026-10-09T12:00:00.000Z" };
const root = { id, status: "running", executionRootRunId: id, executionResources: snapshot };
const record = { runId: id, parentRunId: null, sourceType: "manual", sourceKey: null, status: "running", collaborationTrackingVersion: "v1" };
const graph = () => ({ anchor: id, rootKnown: true, flags: { missingParent: false, cycleDetected: false, truncated: false }, included: new Map([[id, { row: record, depth: 0 }]]) });
const tx = {
  select: () => { const query = { from: () => query, where: (value: unknown) => { mocks.where(value); return query; }, for: () => { mocks.locks(); return query; }, limit: mocks.rows,
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => mocks.rows().then(resolve, reject) }; return query; },
  execute: mocks.execute, update: () => ({ set: (value: unknown) => { mocks.update(value); return { where: (value: unknown) => { mocks.where(value); return Promise.resolve([]); } }; } }),
} as unknown as Parameters<typeof prepareExecutionResourceScope>[0];
beforeEach(() => { vi.clearAllMocks(); mocks.graph.mockReset().mockResolvedValue(graph()); mocks.rows.mockReset().mockResolvedValue([]); mocks.execute.mockReset().mockResolvedValue([{ count: "0" }]); });
describe("执行资源准入服务", () => {
  it("工作区锁使用规范标识和事务锁，外部值参数化", async () => {
    await lockExecutionWorkspace(tx, workspace.toUpperCase());
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]); expect(query.sql).toContain("pg_advisory_xact_lock"); expect(query.params).toContain(`execution-resources:${workspace}`);
  });
  it("并发容量包含所有非终态与未知状态，按整链保留，不排除归档或等待", async () => {
    mocks.execute.mockResolvedValue([{ reservedChains: "3", untrackedActiveRuns: "2" }]);
    expect(await readExecutionCapacity(tx, workspace)).toEqual({ reservedChains: 3, untrackedActiveRuns: 2 });
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(query.sql).toContain("count(distinct coalesce"); expect(query.params).toContain(workspace); expect(query.sql).toContain("'completed', 'failed', 'cancelled'"); expect(query.sql).not.toMatch(/archived_at|waiting_event|waiting_approval/);
  });
  it("根任务容量先检查，再冻结，已满不能生成快照", async () => {
    mocks.rows.mockResolvedValue([]); mocks.execute.mockResolvedValue([{ reservedChains: "50", untrackedActiveRuns: "50" }]);
    await expect(reserveRootExecutionResources(tx, workspace)).rejects.toBeInstanceOf(ExecutionResourceRejected);
    mocks.execute.mockResolvedValue([{ reservedChains: "49", untrackedActiveRuns: "49" }]);
    expect(await reserveRootExecutionResources(tx, workspace)).toMatchObject({ coverage: "new-root", limits: { maxModelCalls: 200 } });
  });
  it("根锁先于受控副作用，历史采用部分覆盖但不刷新启动租约时间", async () => {
    mocks.rows.mockResolvedValueOnce([{ ...root, executionRootRunId: null, executionResources: null }]).mockResolvedValueOnce([{ id, executionRootRunId: null, executionResources: null }]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const scope = await prepareExecutionResourceScope(tx, workspace, id);
    expect(scope).toMatchObject({ rootRunId: id, ids: [id], snapshot: { coverage: "legacy-or-partial", policyRevision: 0 } });
    expect(mocks.locks).toHaveBeenCalledTimes(1); expect(mocks.update.mock.calls[0][0]).not.toHaveProperty("updatedAt");
    expect(mocks.update).toHaveBeenCalledWith({ executionRootRunId: id, executionResources: scope.snapshot });
  });
  it.each(["missingParent", "cycleDetected", "truncated"] as const)("%s 关系拒绝新副作用，不写资源归属", async (flag) => {
    const value = graph(); value.flags[flag] = true; mocks.graph.mockResolvedValue(value);
    await expect(prepareExecutionResourceScope(tx, workspace, id)).rejects.toSatisfy(FatalError.is); expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.rows).not.toHaveBeenCalled();
  });
  it("坏 JSON、部分元数据、外来归属、图外同根记录安全永久停止", async () => {
    for (const row of [{ id, executionRootRunId: child, executionResources: snapshot }, { id, executionRootRunId: id, executionResources: null }, { id, executionRootRunId: id, executionResources: {} }]) {
      mocks.rows.mockReset().mockResolvedValueOnce([root]).mockResolvedValueOnce([row]).mockResolvedValue([]);
      await expect(prepareExecutionResourceScope(tx, workspace, id)).rejects.toSatisfy(FatalError.is);
    }
    mocks.rows.mockReset().mockResolvedValueOnce([root]).mockResolvedValueOnce([root]).mockResolvedValueOnce([{ id: child }]);
    await expect(prepareExecutionResourceScope(tx, workspace, id)).rejects.toSatisfy(FatalError.is);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("已结束根任务和未知状态不允许继续调用", async () => {
    mocks.rows.mockResolvedValueOnce([{ ...root, status: "completed" }]); await expect(prepareExecutionResourceScope(tx, workspace, id)).rejects.toSatisfy(FatalError.is);
    const value = graph(); value.included.get(id)!.row.status = "unknown"; mocks.graph.mockResolvedValue(value);
    await expect(prepareExecutionResourceScope(tx, workspace, id)).rejects.toSatisfy(FatalError.is);
  });
  it("每次调用意图计数包含失败、未确认和归档，不退还也不读取模型正文", async () => {
    const scope = { rootRunId: id, snapshot, ids: [id, child] };
    mocks.execute.mockResolvedValue([{ count: "1" }]); await expect(enforceModelCallResourceLimit(tx, workspace, scope)).rejects.toSatisfy(FatalError.is);
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]); expect(query.params).toEqual(expect.arrayContaining([workspace, id, child])); expect(query.sql).not.toMatch(/"state"|archived_at|measurement|input|output/);
    mocks.execute.mockResolvedValue([{ count: "0" }]); await expect(enforceModelCallResourceLimit(tx, workspace, scope)).resolves.toBeUndefined();
    mocks.execute.mockResolvedValue([{ count: "9007199254740992" }]); await expect(enforceModelCallResourceLimit(tx, workspace, scope)).rejects.toSatisfy(FatalError.is);
  });
  it("协作额度计全部已创建子任务，零额度阻断，根任务不计子任务", () => {
    expect(() => enforceChildRunResourceLimit({ rootRunId: id, snapshot, ids: [id] })).not.toThrow();
    expect(() => enforceChildRunResourceLimit({ rootRunId: id, snapshot, ids: [id, child] })).toThrow();
    expect(() => enforceChildRunResourceLimit({ rootRunId: id, snapshot: { ...snapshot, limits: { ...snapshot.limits, maxChildRuns: 0 } }, ids: [id] })).toThrow();
  });
});
