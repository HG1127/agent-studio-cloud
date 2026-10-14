import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { AgentManifest } from "@/contracts/manifest";
import { createRunStartLease } from "@/server/services/run-start-lease";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  completeEvaluationForRun: vi.fn(),
  updateRows: [] as unknown[],
  updateFilters: [] as SQL[],
  selectError: null as Error | null,
  selectRows: [] as unknown[],
  updateError: null as Error | null,
  updateValues: [] as unknown[],
}));

vi.mock("workflow/api", () => ({ start: mocks.start }));
vi.mock("@/server/workflows/agent-run", () => ({ agentRunWorkflow: vi.fn() }));
vi.mock("@/server/services/evaluation-state", () => ({ completeEvaluationForRun: mocks.completeEvaluationForRun }));
vi.mock("@/lib/db", () => ({
  db: {
    update: () => ({ set: (values: unknown) => { mocks.updateValues.push(values); return { where: (filter: SQL) => {
      mocks.updateFilters.push(filter);
      return { returning: async () => { if (mocks.updateError) throw mocks.updateError; return mocks.updateRows; } };
    } }; } }),
    select: () => {
      if (mocks.selectError) throw mocks.selectError;
      return { from: () => ({ where: () => ({ limit: async () => mocks.selectRows }) }) };
    },
  },
}));

import { launchClaimedRun, resumeQueuedRunStartCore } from "@/server/services/start-run-core";

const RUN_ID = "00000000-0000-4000-8000-0000000000b1";
const args = () => ({
  runId: RUN_ID,
  manifest: {} as AgentManifest,
  input: {},
  lease: createRunStartLease(),
});

beforeEach(() => {
  mocks.start.mockReset().mockRejectedValue(new Error("启动响应丢失"));
  mocks.completeEvaluationForRun.mockReset();
  mocks.updateRows = [];
  mocks.updateFilters = [];
  mocks.selectError = null;
  mocks.selectRows = [];
  mocks.updateError = null;
  mocks.updateValues = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => vi.restoreAllMocks());

describe("启动响应丢失时的运行状态", () => {
  it("无法判定平台是否接收时保留原运行与启动租约", async () => {
    await expect(launchClaimedRun(args())).resolves.toEqual({ ok: true, runId: RUN_ID });
    expect(mocks.updateFilters).toEqual([]);
    expect(vi.mocked(console.error)).toHaveBeenCalledOnce();
    expect(mocks.completeEvaluationForRun).not.toHaveBeenCalled();
  });

  it("尚未接管运行时数据库故障返回可重试结果", async () => {
    mocks.selectError = new Error("数据库暂时不可用");

    await expect(resumeQueuedRunStartCore(RUN_ID)).resolves.toEqual({
      ok: false,
      error: "继续启动失败，请稍后重试",
      retryable: true,
    });
    expect(vi.mocked(console.error)).toHaveBeenCalledOnce();
  });
});

describe("启动句柄回写与初始化身份竞争", () => {
  it("回写包含工作区、租约、活跃状态和执行者空值或相同值的原子条件", async () => {
    const request = args(), cancel = vi.fn();
    mocks.start.mockResolvedValue({ runId: "wrun_owner", cancel });
    mocks.updateRows = [{ id: RUN_ID }];
    await expect(launchClaimedRun(request)).resolves.toEqual({ ok: true, runId: RUN_ID });
    const query = new PgDialect().sqlToQuery(mocks.updateFilters[0]);
    expect(query.sql).toMatch(/"workflow_run_id" is null or "runs"\."workflow_run_id" = \$\d+/);
    expect(query.sql).toContain('"runs"."workspace_id"');
    expect(query.sql).toContain('"runs"."status" in');
    expect(query.params).toEqual(expect.arrayContaining([RUN_ID, request.lease.token, "wrun_owner", "queued", "running", "waiting_approval", "waiting_event"]));
    expect(cancel).not.toHaveBeenCalled();
  });
  it.each([false, true])("提交结果未知=%s 但复读同一已绑定执行者时不取消或写失败", async (saveError) => {
    const request = args(), cancel = vi.fn();
    mocks.start.mockResolvedValue({ runId: "wrun_owner", cancel });
    if (saveError) mocks.updateError = new Error("保存已提交但响应丢失");
    mocks.selectRows = [{ status: "running", workflowRunId: "wrun_owner", stepStates: { __startup: request.lease } }];
    await expect(launchClaimedRun(request)).resolves.toEqual({ ok: true, runId: RUN_ID });
    expect(cancel).not.toHaveBeenCalled();
    expect(mocks.updateValues).toHaveLength(1);
    expect(mocks.completeEvaluationForRun).not.toHaveBeenCalled();
  });
  it("回写与复读均失败时保留已接收状态，不取消未知执行者", async () => {
    const cancel = vi.fn();
    mocks.start.mockResolvedValue({ runId: "wrun_owner", cancel });
    mocks.updateError = new Error("保存结果未知");
    mocks.selectError = new Error("复读失败");
    await expect(launchClaimedRun(args())).resolves.toEqual({ ok: true, runId: RUN_ID });
    expect(cancel).not.toHaveBeenCalled();
    expect(mocks.updateValues).toHaveLength(1);
    expect(mocks.completeEvaluationForRun).not.toHaveBeenCalled();
  });
  it("回写失败且同租约尚未绑定时不能推断平台没有执行", async () => {
    const request = args(), cancel = vi.fn();
    mocks.start.mockResolvedValue({ runId: "wrun_owner", cancel });
    mocks.updateError = new Error("保存失败");
    mocks.selectRows = [{ status: "queued", workflowRunId: null, stepStates: { __startup: request.lease } }];
    await expect(launchClaimedRun(request)).resolves.toEqual({ ok: true, runId: RUN_ID });
    expect(cancel).not.toHaveBeenCalled();
  });
  it.each([
    { status: "running", workflowRunId: "wrun_other", stepStates: {} },
    { status: "cancelled", workflowRunId: "wrun_owner", stepStates: {} },
    { status: "queued", workflowRunId: null, stepStates: { __startup: createRunStartLease() } },
  ])("复读确认其他执行者、取消或租约接管才取消本次迟到句柄", async (current) => {
    const cancel = vi.fn();
    mocks.start.mockResolvedValue({ runId: "wrun_owner", cancel });
    mocks.selectRows = [current];
    await expect(launchClaimedRun(args())).resolves.toEqual({ ok: true, runId: RUN_ID });
    expect(cancel).toHaveBeenCalledOnce();
    expect(mocks.updateValues).toHaveLength(1);
    expect(mocks.completeEvaluationForRun).not.toHaveBeenCalled();
  });
  it("完成结果归属同一执行者时即使租约已清除也不取消", async () => {
    const cancel = vi.fn();
    mocks.start.mockResolvedValue({ runId: "wrun_owner", cancel });
    mocks.selectRows = [{ status: "completed", workflowRunId: "wrun_owner", stepStates: {} }];
    await expect(launchClaimedRun(args())).resolves.toEqual({ ok: true, runId: RUN_ID });
    expect(cancel).not.toHaveBeenCalled();
  });
});
