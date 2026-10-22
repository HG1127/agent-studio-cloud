import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { WorkflowDraft } from "@/contracts/workflow";
import { createRunStartLease, readRunStartLease, withRunStartLease } from "@/server/services/run-start-lease";
import { HarnessPolicyDataError } from "@/server/domain/harness/management";

const mocks = vi.hoisted(() => ({ metadata: vi.fn(), rows: vi.fn(), update: vi.fn(), trace: vi.fn(), freezeHarness: vi.fn(), filters: [] as SQL[], values: [] as Record<string, unknown>[] }));
vi.mock("workflow", async (original) => ({ ...await original<typeof import("workflow")>(), getWorkflowMetadata: mocks.metadata }));
vi.mock("@/server/steps/trace-step", () => ({ appendTrace: mocks.trace }));
vi.mock("@/server/services/harness-policies", () => ({ freezeRunHarnessPolicy: mocks.freezeHarness }));
vi.mock("@/lib/db", () => { const client = {
  select: () => { const query = { from: () => query, where: () => query, for: () => query, limit: mocks.rows }; return query; },
  update: () => ({ set: (values: Record<string, unknown>) => ({ where: (filter: SQL) => {
    mocks.filters.push(filter); mocks.values.push(values);
    return { returning: () => mocks.update(values, filter) };
  } }) }),
}; return { db: { ...client, transaction: async (callback: (tx: typeof client) => unknown) => callback(client) } }; });

import { initializeRun } from "./run-state";

const RUN = "123e4567-e89b-42d3-a456-426614174000", WORKSPACE = "123e4567-e89b-42d3-a456-426614174001";
const draft = { startNodeId: "start", rootAgent: { name: "测试助手" } } as WorkflowDraft;
const fixture = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({ id: RUN, workspaceId: WORKSPACE, status: "queued", workflowRunId: null, stepStates: {}, parentRunId: null, sourceType: "manual", harnessPolicySnapshot: null, ...overrides });
beforeEach(() => {
  mocks.metadata.mockReset().mockReturnValue({ workflowRunId: "wrun_A" });
  mocks.rows.mockReset(); mocks.update.mockReset().mockResolvedValue([{ id: RUN }]); mocks.trace.mockReset().mockResolvedValue(undefined);
  mocks.filters = []; mocks.values = [];
  mocks.freezeHarness.mockReset().mockResolvedValue(null);
});

describe("初始化执行者原子绑定", () => {
  it("真实执行身份缺失时在任何数据库操作前永久拒绝，不使用直接调用占位身份", async () => {
    mocks.metadata.mockImplementation(() => { throw new Error("不在引擎上下文"); });
    await expect(initializeRun(RUN, draft)).rejects.toThrow("执行身份无法确认");
    expect(mocks.rows).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.trace).not.toHaveBeenCalled();
  });
  it("首次领取同时冻结身份与跟踪覆盖，条件包含工作区、排队态、租约及身份CAS", async () => {
    const lease = createRunStartLease(); mocks.rows.mockResolvedValue([fixture({ stepStates: withRunStartLease({}, lease) })]);
    await initializeRun(RUN, draft, lease.token);
    expect(mocks.values[0]).toEqual(expect.objectContaining({ status: "running", workflowRunId: "wrun_A", modelUsageTrackingVersion: "v1", collaborationTrackingVersion: "v1" }));
    const query = new PgDialect().sqlToQuery(mocks.filters[0]);
    expect(query.sql).toMatch(/"workflow_run_id" is null or "runs"\."workflow_run_id" = \$\d+/);
    expect(query.sql).toContain('"runs"."workspace_id"');
    expect(query.params).toEqual(expect.arrayContaining([RUN, WORKSPACE, "queued", "wrun_A", lease.token]));
  });
  it("同租约两执行者都读到未绑定排队态，只有一个CAS可以进入业务", async () => {
    const lease = createRunStartLease(), row = fixture({ stepStates: withRunStartLease({}, lease) });
    mocks.metadata.mockReturnValueOnce({ workflowRunId: "wrun_A" }).mockReturnValueOnce({ workflowRunId: "wrun_B" });
    mocks.rows.mockResolvedValueOnce([structuredClone(row)]).mockResolvedValueOnce([structuredClone(row)]).mockImplementation(async () => [row]);
    mocks.update.mockImplementation(async (values: Record<string, unknown>, filter: SQL) => {
      const query = new PgDialect().sqlToQuery(filter);
      expect(query.sql).toMatch(/"workflow_run_id" is null or "runs"\."workflow_run_id" = \$\d+/);
      expect(query.params).toEqual(expect.arrayContaining([WORKSPACE, "queued", values.workflowRunId, lease.token]));
      if (row.status !== "queued" || (row.workflowRunId !== null && row.workflowRunId !== values.workflowRunId) || readRunStartLease(row.stepStates)?.token !== lease.token) return [];
      Object.assign(row, values); return [{ id: RUN }];
    });
    const results = await Promise.allSettled([initializeRun(RUN, draft, lease.token), initializeRun(RUN, draft, lease.token)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason.message).toContain("其他执行请求");
    expect(row).toMatchObject({ status: "running", workflowRunId: "wrun_A" }); expect(mocks.trace).toHaveBeenCalledOnce();
  });
  it("相同执行者重入只修轨迹，不重写已经提交的开始时间和覆盖版本", async () => {
    const startedAt = new Date("2026-10-01T00:00:00Z"), row = fixture({ status: "running", workflowRunId: "wrun_A", startedAt, modelUsageTrackingVersion: null });
    mocks.rows.mockResolvedValue([row]); mocks.update.mockResolvedValue([]);
    await initializeRun(RUN, draft);
    expect(row.startedAt).toEqual(startedAt); expect(row.modelUsageTrackingVersion).toBeNull(); expect(mocks.trace).toHaveBeenCalledOnce();
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.freezeHarness).not.toHaveBeenCalled();
  });
  it.each([
    { status: "running", workflowRunId: null, message: "尚未确认" },
    { status: "queued", workflowRunId: "wrun_B", message: "其他执行请求" },
    { status: "running", workflowRunId: "wrun_B", message: "其他执行请求" },
    { status: "cancelled", workflowRunId: "wrun_A", message: "不能重新启动" },
  ])("预读 $status 身份冲突或终态不更新记录", async ({ status, workflowRunId, message }) => {
    mocks.rows.mockResolvedValue([fixture({ status, workflowRunId })]);
    await expect(initializeRun(RUN, draft)).rejects.toThrow(message);
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.trace).not.toHaveBeenCalled();
  });
  it.each(["cancelled", "lease_replaced"])("初读后发生 %s 时CAS失败不能补启动轨迹", async (change) => {
    const lease = createRunStartLease();
    mocks.rows.mockResolvedValueOnce([fixture({ stepStates: withRunStartLease({}, lease) })]).mockResolvedValueOnce([fixture({ status: change === "cancelled" ? "cancelled" : "queued", stepStates: withRunStartLease({}, createRunStartLease()) })]);
    mocks.update.mockResolvedValue([]);
    await expect(initializeRun(RUN, draft, lease.token)).rejects.toThrow(change === "cancelled" ? "不能重新启动" : "新的请求接管");
    expect(mocks.trace).not.toHaveBeenCalled();
  });
  it("仅过期但尚未接管的租约不误拒已有执行者", async () => {
    const lease = createRunStartLease(new Date("2020-01-01T00:00:00Z"));
    mocks.rows.mockResolvedValue([fixture({ stepStates: withRunStartLease({}, lease) })]);
    await initializeRun(RUN, draft, lease.token); expect(mocks.trace).toHaveBeenCalledOnce();
  });
  it.each(["queued", "running"])("%s 中损坏租约不能伪装成无租约子运行", async (status) => {
    mocks.rows.mockResolvedValue([fixture({ status, workflowRunId: "wrun_A", stepStates: { __startup: { token: "invalid" } } })]);
    await expect(initializeRun(RUN, draft)).rejects.toThrow("尚未确认");
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.trace).not.toHaveBeenCalled();
  });
  it("内联子运行无租约可以保存父实际引擎身份，不另造执行者", async () => {
    mocks.rows.mockResolvedValue([fixture({ parentRunId: "123e4567-e89b-42d3-a456-426614174002", sourceType: "agent_call" })]);
    await initializeRun(RUN, draft);
    expect(mocks.values[0].workflowRunId).toBe("wrun_A");
    expect(new PgDialect().sqlToQuery(mocks.filters[0]).sql).toContain("is null");
  });
  it("首次启动将快照与实际身份一并提交，冻结失败不写任何开始状态", async () => {
    const snapshot = { version: 1, workspaceId: WORKSPACE, revision: 0, policy: null, frozenAt: "2026-10-12T00:00:00.000Z" };
    mocks.rows.mockResolvedValue([fixture()]); mocks.freezeHarness.mockResolvedValueOnce(snapshot);
    await initializeRun(RUN, draft);
    expect(mocks.values[0]).toMatchObject({ workflowRunId: "wrun_A", harnessPolicySnapshot: snapshot });
    mocks.values = []; mocks.update.mockClear(); mocks.trace.mockClear();
    mocks.freezeHarness.mockRejectedValueOnce(new HarnessPolicyDataError());
    await expect(initializeRun(RUN, draft)).rejects.toThrow("冻结记录无效");
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.trace).not.toHaveBeenCalled();
  });
});
