import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentManifest } from "@/contracts/manifest";

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[][],
  locks: [] as string[],
  updates: [] as Record<string, unknown>[],
  inserts: [] as Record<string, unknown>[],
  revalidatePath: vi.fn(),
}));

const tx = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => mocks.rows.shift() ?? [],
        orderBy: () => ({ limit: async () => mocks.rows.shift() ?? [] }),
        for: (mode: string) => ({ limit: async () => {
          mocks.locks.push(mode);
          return mocks.rows.shift() ?? [];
        } }),
      }),
    }),
  }),
  update: () => ({
    set: (values: Record<string, unknown>) => ({
      where: () => ({ returning: async () => {
        mocks.updates.push(values);
        return [{ id: SCHEDULE_ID }];
      } }),
    }),
  }),
  insert: () => ({
    values: (values: Record<string, unknown>) => ({
      onConflictDoNothing: () => ({ returning: async () => {
        mocks.inserts.push(values);
        return [{ id: SCHEDULE_ID }];
      } }),
    }),
  }),
};

vi.mock("@/lib/db", () => ({ db: { transaction: async (run: (client: typeof tx) => unknown) => run(tx) } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { updateScheduleStatusAction } from "@/server/actions/update-schedule-status";
import { createScheduleAction } from "@/server/actions/create-schedule";

const AGENT_ID = "00000000-0000-4000-8000-000000000301";
const SCHEDULE_ID = "00000000-0000-4000-8000-000000000302";
const VERSION_ID = "00000000-0000-4000-8000-000000000303";
const schedule = {
  id: SCHEDULE_ID,
  agentId: AGENT_ID,
  versionId: VERSION_ID,
  workspaceId: "00000000-0000-4000-8000-000000000001",
  status: "paused",
  archivedAt: null,
  spec: { kind: "interval", minutes: 5 },
};
const manifest = AgentManifest.parse({
  schemaVersion: "4.0",
  workflowFingerprint: "f".repeat(64),
  inputContract: { fields: [] },
  resourceSelection: { model: { modelId: "mock", mock: true } },
  designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
  knowledgeSnapshot: [],
  workflowSnapshot: {
    id: "schedule-resume-test",
    startNodeId: "start",
    rootAgent: { id: AGENT_ID, name: "定时测试助手", role: "通用业务助手" },
    memoryPolicy: { taskContext: true, longTerm: false },
    nodes: {
      start: { id: "start", title: "收到任务", type: "trigger", next: "done" },
      done: { id: "done", title: "流程结束", type: "end", next: null },
    },
  },
});

beforeEach(() => {
  mocks.rows = [];
  mocks.locks = [];
  mocks.updates = [];
  mocks.inserts = [];
  mocks.revalidatePath.mockReset();
});

describe("定时任务创建并发保护", () => {
  it("助手在创建前被停用时不插入启用任务", async () => {
    mocks.rows = [[]];

    expect(await createScheduleAction({ agentId: AGENT_ID, spec: { kind: "interval", minutes: 5 }, input: {} })).toEqual({
      ok: false,
      error: "找不到这个助手，请刷新页面后重试",
    });
    expect(mocks.locks).toEqual(["share"]);
    expect(mocks.inserts).toHaveLength(0);
  });

  it("持有助手共享锁直到任务插入完成", async () => {
    mocks.rows = [
      [{ id: AGENT_ID, workspaceId: schedule.workspaceId }],
      [{ id: VERSION_ID, manifest }],
    ];

    expect(await createScheduleAction({ agentId: AGENT_ID, spec: { kind: "interval", minutes: 5 }, input: {} })).toEqual({ ok: true });
    expect(mocks.locks).toEqual(["share"]);
    expect(mocks.inserts).toEqual([expect.objectContaining({
      agentId: AGENT_ID,
      versionId: VERSION_ID,
      status: "active",
      nextRunAt: expect.any(Date),
    })]);
  });
});

describe("定时任务状态并发保护", () => {
  it("助手仍启用且版本有效时可以恢复任务", async () => {
    mocks.rows = [
      [{ agentId: AGENT_ID }],
      [{ archivedAt: null }],
      [schedule],
      [{ manifest }],
    ];

    expect(await updateScheduleStatusAction(SCHEDULE_ID, "active")).toEqual({ ok: true });
    expect(mocks.locks).toEqual(["share", "update"]);
    expect(mocks.updates).toEqual([expect.objectContaining({
      status: "active",
      archivedAt: null,
      nextRunAt: expect.any(Date),
      consecutiveFailures: 0,
      lastError: null,
    })]);
  });

  it("助手已停用时不能把暂停的任务恢复为启用", async () => {
    mocks.rows = [
      [{ agentId: AGENT_ID }],
      [{ archivedAt: new Date() }],
      [schedule],
    ];

    expect(await updateScheduleStatusAction(SCHEDULE_ID, "active")).toEqual({
      ok: false,
      error: "绑定的助手已停用，请恢复助手后再启用定时任务",
    });
    expect(mocks.locks).toEqual(["share", "update"]);
    expect(mocks.updates).toHaveLength(0);
  });

  it("助手锁先于任务锁，暂停操作也遵守相同顺序", async () => {
    mocks.rows = [
      [{ agentId: AGENT_ID }],
      [{ archivedAt: null }],
      [{ ...schedule, status: "active" }],
    ];

    expect(await updateScheduleStatusAction(SCHEDULE_ID, "paused")).toEqual({ ok: true });
    expect(mocks.locks).toEqual(["share", "update"]);
    expect(mocks.updates).toEqual([expect.objectContaining({ status: "paused", leaseUntil: null })]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/schedules");
  });

  it("任务已被归档时旧页面不能重新启用", async () => {
    mocks.rows = [
      [{ agentId: AGENT_ID }],
      [{ archivedAt: null }],
      [{ ...schedule, status: "archived", archivedAt: new Date() }],
    ];

    expect(await updateScheduleStatusAction(SCHEDULE_ID, "active")).toEqual({
      ok: false,
      error: "找不到这条定时任务，请刷新页面后重试",
    });
    expect(mocks.updates).toHaveLength(0);
  });
});
