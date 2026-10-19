import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { AgentManifest } from "@/contracts/manifest";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { createRunStartLease, MAX_RUN_START_ATTEMPTS, withRunStartLease } from "./run-start-lease";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  completeEvaluation: vi.fn(),
  selectFilters: [] as SQL[],
  updateFilters: [] as SQL[],
  updateValues: [] as Record<string, unknown>[],
  selectRows: [] as Record<string, unknown>[],
  updateRows: [] as { id: string }[][],
}));

vi.mock("workflow/api", () => ({ start: mocks.start }));
vi.mock("@/server/workflows/agent-run", () => ({ agentRunWorkflow: vi.fn() }));
vi.mock("@/server/services/evaluation-state", () => ({ completeEvaluationForRun: mocks.completeEvaluation }));
vi.mock("@/lib/db", () => ({ db: {
  select: () => {
    const query = {
      from: () => query,
      leftJoin: () => query,
      where: (filter: SQL) => { mocks.selectFilters.push(filter); return query; },
      limit: async () => mocks.selectRows,
    };
    return query;
  },
  update: () => ({ set: (values: Record<string, unknown>) => {
    mocks.updateValues.push(values);
    return { where: (filter: SQL) => {
      mocks.updateFilters.push(filter);
      return { returning: async () => {
        return mocks.updateRows.shift() ?? [];
      } };
    } };
  } }),
} }));

import { resumeQueuedRunStartCore } from "./start-run-core";

const RUN_ID = "00000000-0000-4000-8000-0000000000b1";
const AGENT_ID = "00000000-0000-4000-8000-0000000000b2";
const OLD = new Date("2000-01-01T00:00:00.000Z");
const manifest = AgentManifest.parse({
  schemaVersion: "4.0", workflowFingerprint: "7".repeat(64), inputContract: { fields: [] },
  resourceSelection: { model: { modelId: "mock", mock: true } },
  designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
  workflowSnapshot: { id: "root-recovery", startNodeId: "start",
    rootAgent: { id: AGENT_ID, name: "恢复测试", role: "测试" }, memoryPolicy: { taskContext: true, longTerm: false },
    nodes: { start: { id: "start", title: "开始", type: "trigger", next: "done" },
      done: { id: "done", title: "结束", type: "end", next: null } },
  },
});

function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: RUN_ID, agentId: AGENT_ID, workspaceId: DEMO_WORKSPACE_ID, input: {},
    stepStates: { preserved: true }, updatedAt: OLD, manifest, existingAgentId: AGENT_ID, agentArchivedAt: null, ...overrides };
}

function expectRootScope(filter: SQL): void {
  const { sql, params } = new PgDialect().sqlToQuery(filter);
  expect(sql).toContain('"runs"."source_type" in (\'manual\', \'schedule\', \'evaluation\')');
  expect(sql).toContain('"runs"."parent_run_id" is null');
  expect(sql).toContain('"runs"."execution_root_run_id" is null or "runs"."execution_root_run_id" = "runs"."id"');
  expect(params).toEqual(expect.arrayContaining([RUN_ID, DEMO_WORKSPACE_ID]));
}

beforeEach(() => {
  mocks.start.mockReset().mockResolvedValue({ runId: "wrun_recovered", cancel: vi.fn() });
  mocks.completeEvaluation.mockReset();
  mocks.selectFilters = [];
  mocks.updateFilters = [];
  mocks.updateValues = [];
  mocks.selectRows = [candidate()];
  mocks.updateRows = [[{ id: RUN_ID }], [{ id: RUN_ID }]];
});

afterEach(() => vi.restoreAllMocks());

describe("根运行单条恢复的原子范围", () => {
  it("无租约的旧主任务仍可恢复，读取、领取和回包绑定都限制同一根范围", async () => {
    await expect(resumeQueuedRunStartCore(RUN_ID)).resolves.toEqual({ ok: true, runId: RUN_ID });
    expect(mocks.selectFilters).toHaveLength(1);
    expect(mocks.updateFilters).toHaveLength(2);
    for (const filter of [...mocks.selectFilters, ...mocks.updateFilters]) expectRootScope(filter);
    const claim = new PgDialect().sqlToQuery(mocks.updateFilters[0]);
    expect(claim.sql).toContain('"runs"."workflow_run_id" is null');
    expect(claim.sql).toContain('"runs"."step_states" =');
    expect(mocks.updateValues[0].stepStates).toMatchObject({ preserved: true, __startup: { attempt: 1 } });
    expect(mocks.start).toHaveBeenCalledOnce();
  });

  it("候选不在根范围时不领取、不终结、不另开引擎", async () => {
    mocks.selectRows = [];
    await expect(resumeQueuedRunStartCore(RUN_ID)).resolves.toEqual({ ok: false, error: "这次运行已经开始或结束，请刷新页面查看状态" });
    expectRootScope(mocks.selectFilters[0]);
    expect(mocks.updateFilters).toEqual([]);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.completeEvaluation).not.toHaveBeenCalled();
  });

  it("领取条件失效返回零行时不能继续启动", async () => {
    mocks.updateRows = [[]];
    await expect(resumeQueuedRunStartCore(RUN_ID)).resolves.toEqual({ ok: true, runId: RUN_ID });
    expect(mocks.updateFilters).toHaveLength(1);
    expectRootScope(mocks.updateFilters[0]);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.completeEvaluation).not.toHaveBeenCalled();
  });

  it("尚未过期的主任务不重复领取", async () => {
    mocks.selectRows = [candidate({ stepStates: withRunStartLease({}, createRunStartLease()) })];
    await expect(resumeQueuedRunStartCore(RUN_ID)).resolves.toEqual({ ok: false, error: "运行仍在启动中，请稍后刷新页面" });
    expectRootScope(mocks.selectFilters[0]);
    expect(mocks.updateFilters).toEqual([]);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it.each([{ changed: false }, { changed: true }])("达到启动上限时终结仍有根范围条件：归属竞争=$changed", async ({ changed }) => {
    const lease = createRunStartLease(OLD, MAX_RUN_START_ATTEMPTS);
    mocks.selectRows = [candidate({ stepStates: withRunStartLease({}, lease) })];
    mocks.updateRows = [changed ? [] : [{ id: RUN_ID }]];
    const result = await resumeQueuedRunStartCore(RUN_ID);
    expect(result).toEqual(changed ? { ok: true, runId: RUN_ID } : { ok: false, error: "运行多次启动未获确认，请重新发起" });
    expect(mocks.updateFilters).toHaveLength(1);
    expectRootScope(mocks.updateFilters[0]);
    const query = new PgDialect().sqlToQuery(mocks.updateFilters[0]);
    expect(query.sql).toContain('"runs"."workflow_run_id" is null');
    expect(query.params).toContain(lease.token);
    expect(mocks.completeEvaluation).toHaveBeenCalledTimes(changed ? 0 : 1);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it.each([
    { label: "助手停用", values: { agentArchivedAt: OLD } },
    { label: "冻结版本损坏", values: { manifest: {} } },
  ])("领取后$label时只终结仍归属当前根的记录", async ({ values }) => {
    mocks.selectRows = [candidate(values)];
    const result = await resumeQueuedRunStartCore(RUN_ID);
    expect(result.ok).toBe(false);
    expect(mocks.updateFilters).toHaveLength(2);
    for (const filter of mocks.updateFilters) expectRootScope(filter);
    expect(mocks.updateValues[1]).toMatchObject({ status: "failed" });
    expect(mocks.completeEvaluation).toHaveBeenCalledOnce();
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
