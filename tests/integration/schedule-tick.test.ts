import { eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const { startMock, revalidatePathMock } = vi.hoisted(() => ({ startMock: vi.fn(), revalidatePathMock: vi.fn() }));
vi.mock("workflow/api", () => ({ start: startMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
import { AgentManifest } from "@/contracts/manifest";
import { agentVersions, agents, runs, schedules } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { POST as tick } from "@/app/api/schedules/tick/route";
import { listScheduleableAgents } from "@/server/queries/schedules";
import { createScheduleAction } from "@/server/actions/create-schedule";
import { updateScheduleStatusAction } from "@/server/actions/update-schedule-status";

const AGENT_ID = "00000000-0000-4000-8000-0000000000e9";
const VERSION_ID = "00000000-0000-4000-8000-0000000000ea";
const SCHEDULE_DUE = "00000000-0000-4000-8000-0000000000eb";
const SCHEDULE_ONCE = "00000000-0000-4000-8000-0000000000ec";
const SCHEDULE_PAUSED = "00000000-0000-4000-8000-0000000000ed";
const SCHEDULE_FAILING = "00000000-0000-4000-8000-0000000000ee";
const DRAFT_AGENT_ID = "00000000-0000-4000-8000-0000000000ef";
const RETIRED_VERSION_ID = "00000000-0000-4000-8000-0000000000f0";
const RETIRED_SCHEDULE_ID = "00000000-0000-4000-8000-0000000000f1";
const PAUSED_DURING_START_ID = "00000000-0000-4000-8000-0000000000f2";
const OTHER_WORKSPACE_SCHEDULE_ID = "00000000-0000-4000-8000-0000000000f3";
const OTHER_WORKSPACE_ID = "00000000-0000-4000-8000-0000000000f4";
const createdScheduleIds: string[] = [];

const manifest = AgentManifest.parse({
  schemaVersion: "4.0",
  workflowFingerprint: "f".repeat(64),
  inputContract: { fields: [] },
  resourceSelection: { model: { modelId: "mock", mock: true } },
  designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
  knowledgeSnapshot: [],
  workflowSnapshot: {
    id: "draft-m3-schedule",
    startNodeId: "start",
    rootAgent: { id: "agt_m3_schedule", name: "定时测试助手", role: "通用业务助手" },
    memoryPolicy: { taskContext: true, longTerm: false },
    nodes: {
      start: { id: "start", title: "收到任务", type: "trigger", next: "done", requirementIds: [] },
      done: { id: "done", title: "流程结束", type: "end", next: null, requirementIds: [] },
    },
  },
});

const authedRequest = () =>
  new Request("http://localhost/api/schedules/tick", { method: "POST", headers: { authorization: "Bearer test-cron-secret" } });

beforeAll(async () => {
  process.env.CRON_SECRET = "test-cron-secret";
  let workflowCount = 0;
  startMock.mockImplementation(async () => ({ runId: `schedule-workflow-${++workflowCount}`, cancel: vi.fn() }));
  await db.insert(agents).values({ id: AGENT_ID, workspaceId: DEMO_WORKSPACE_ID, name: "定时测试助手", intentText: "定时触发的测试助手", createdBy: DEMO_USER_ID });
  await db.insert(agents).values({ id: DRAFT_AGENT_ID, workspaceId: DEMO_WORKSPACE_ID, name: "未发布测试助手", intentText: "尚未发布的测试助手", createdBy: DEMO_USER_ID });
  await db.insert(agentVersions).values({ id: VERSION_ID, agentId: AGENT_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, version: 1, status: "production", manifest });
  await db.insert(agentVersions).values({ id: RETIRED_VERSION_ID, agentId: DRAFT_AGENT_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, version: 1, status: "retired", manifest });
});

afterEach(() => revalidatePathMock.mockReset());

afterAll(async () => {
  await db.delete(runs).where(eq(runs.agentId, AGENT_ID));
  await db.delete(schedules).where(inArray(schedules.id, [SCHEDULE_DUE, SCHEDULE_ONCE, SCHEDULE_PAUSED, SCHEDULE_FAILING, RETIRED_SCHEDULE_ID, PAUSED_DURING_START_ID, OTHER_WORKSPACE_SCHEDULE_ID, ...createdScheduleIds]));
  await db.delete(agentVersions).where(inArray(agentVersions.agentId, [AGENT_ID, DRAFT_AGENT_ID]));
  await db.delete(agents).where(inArray(agents.id, [AGENT_ID, DRAFT_AGENT_ID]));
});

async function insertSchedule(overrides?: Partial<typeof schedules.$inferInsert>) {
  await db.insert(schedules).values({
    workspaceId: DEMO_WORKSPACE_ID, agentId: AGENT_ID, versionId: VERSION_ID,
    status: "active", spec: { kind: "interval", minutes: 5 },
    input: {}, nextRunAt: new Date(Date.now() - 60_000), createdBy: DEMO_USER_ID,
    ...overrides,
  });
}

describe("调度 tick 接口", () => {
  it("可定时助手只包含已有生产版本的助手", async () => {
    const options = await listScheduleableAgents();

    expect(options.some((option) => option.id === AGENT_ID)).toBe(true);
    expect(options.some((option) => option.id === DRAFT_AGENT_ID)).toBe(false);
  });

  it("创建或更新已提交后缓存刷新失败仍返回成功", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const before = await db.select({ id: schedules.id }).from(schedules).where(eq(schedules.agentId, AGENT_ID));
      const beforeIds = new Set(before.map((row) => row.id));
      revalidatePathMock.mockImplementationOnce(() => { throw new Error("缓存暂时不可用"); });
      expect(await createScheduleAction({
        agentId: AGENT_ID,
        spec: { kind: "interval", minutes: 5 },
        input: { testCase: "cache-failure" },
      })).toEqual({ ok: true });
      const after = await db.select({ id: schedules.id }).from(schedules).where(eq(schedules.agentId, AGENT_ID));
      const createdId = after.find((row) => !beforeIds.has(row.id))?.id;
      expect(createdId).toBeDefined();
      createdScheduleIds.push(createdId!);
      revalidatePathMock.mockImplementationOnce(() => { throw new Error("缓存暂时不可用"); });
      expect(await updateScheduleStatusAction(createdId!, "paused")).toEqual({ ok: true });
      const [schedule] = await db.select().from(schedules).where(eq(schedules.id, createdId!)).limit(1);
      expect(schedule?.status).toBe("paused");
      expect(revalidatePathMock).toHaveBeenCalledTimes(2);
      expect(log).toHaveBeenCalledTimes(2);
    } finally {
      log.mockRestore();
    }
  });

  it("暂停任务可继续使用创建时冻结的历史生产版本", async () => {
    await insertSchedule({
      id: RETIRED_SCHEDULE_ID,
      agentId: DRAFT_AGENT_ID,
      versionId: RETIRED_VERSION_ID,
      status: "paused",
      nextRunAt: new Date(Date.now() - 60_000),
    });

    await expect(updateScheduleStatusAction(RETIRED_SCHEDULE_ID, "active")).resolves.toEqual({ ok: true });
    const [schedule] = await db.select().from(schedules).where(eq(schedules.id, RETIRED_SCHEDULE_ID)).limit(1);
    expect(schedule?.status).toBe("active");
    expect(schedule?.versionId).toBe(RETIRED_VERSION_ID);
    expect(schedule?.nextRunAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("无密钥或未配密钥返回 401", async () => {
    const response = await tick(new Request("http://localhost/api/schedules/tick", { method: "POST" }));
    expect(response.status).toBe(401);
  }, 240_000);

  it("到期调度被领取并开出定时 run，next_run_at 推进，source_key 幂等", async () => {
    await insertSchedule({ id: SCHEDULE_DUE });
    const response = await tick(authedRequest());
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.started).toBe(1);
    const [schedule] = await db.select().from(schedules).where(eq(schedules.id, SCHEDULE_DUE)).limit(1);
    expect(schedule?.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    // run 计数按 sourceKey 前缀过滤：不依赖用例执行顺序
    const runsFor = async (prefix: string) => {
      const rows = await db.select().from(runs).where(eq(runs.agentId, AGENT_ID));
      return rows.filter((row) => row.sourceKey?.startsWith(prefix));
    };
    const dueRuns = await runsFor(SCHEDULE_DUE);
    expect(dueRuns).toHaveLength(1);
    expect(dueRuns[0].sourceType).toBe("schedule");
    expect(dueRuns[0].versionId).toBe(VERSION_ID);
    // 第二次 tick：next_run_at 已推进到 5 分钟后，无可领取项，不会重复开 run
    const second = await tick(authedRequest());
    const secondBody = await second.json();
    expect(secondBody.claimed).toBe(0);
    expect(await runsFor(SCHEDULE_DUE)).toHaveLength(1);
  }, 240_000);

  it("一次性任务到期：先开跑这一次再归档", async () => {
    await insertSchedule({ id: SCHEDULE_ONCE, spec: { kind: "once", at: new Date(Date.now() - 60_000).toISOString() } });
    const response = await tick(authedRequest());
    const body = await response.json();
    expect(body.started).toBe(1);
    const [schedule] = await db.select().from(schedules).where(eq(schedules.id, SCHEDULE_ONCE)).limit(1);
    expect(schedule?.status).toBe("archived");
    const rows = await db.select().from(runs).where(eq(runs.agentId, AGENT_ID));
    expect(rows.filter((row) => row.sourceKey?.startsWith(SCHEDULE_ONCE))).toHaveLength(1);
  }, 240_000);

  it("暂停的调度不被领取", async () => {
    await insertSchedule({ id: SCHEDULE_PAUSED, status: "paused" });
    const response = await tick(authedRequest());
    const body = await response.json();
    expect(body.claimed).toBe(0);
  }, 240_000);

  it("只领取演示工作区任务，不推进其他工作区的到期任务", async () => {
    const dueAt = new Date(Date.now() - 60_000);
    await insertSchedule({
      id: OTHER_WORKSPACE_SCHEDULE_ID,
      workspaceId: OTHER_WORKSPACE_ID,
      agentId: "00000000-0000-4000-8000-0000000000f5",
      nextRunAt: dueAt,
    });
    const startsBefore = startMock.mock.calls.length;

    const response = await tick(authedRequest());

    expect(await response.json()).toEqual({ ok: true, claimed: 0, started: 0, failed: 0 });
    const [schedule] = await db.select().from(schedules).where(eq(schedules.id, OTHER_WORKSPACE_SCHEDULE_ID)).limit(1);
    expect(schedule).toMatchObject({
      workspaceId: OTHER_WORKSPACE_ID,
      status: "active",
      nextRunAt: dueAt,
      leaseUntil: null,
      consecutiveFailures: 0,
    });
    expect(startMock).toHaveBeenCalledTimes(startsBefore);
  }, 240_000);

  it("连续失败 3 次后置 error 停跑", async () => {
    await insertSchedule({ id: SCHEDULE_FAILING, agentId: "00000000-0000-4000-8000-0000000000ff", versionId: "00000000-0000-4000-8000-0000000000fe" });
    // 指向不存在的助手 → startRunCore 在 start 之前就走失败路径，不产生 workflow run
    for (let i = 0; i < 3; i += 1) {
      const response = await tick(authedRequest());
      const body = await response.json();
      expect(body.failed).toBe(1);
      // 每轮失败后 next_run_at 已推进 5 分钟，手动拨回过去以复现下一轮失败
      await db.update(schedules).set({ nextRunAt: new Date(Date.now() - 60_000) }).where(eq(schedules.id, SCHEDULE_FAILING));
    }
    const [schedule] = await db.select().from(schedules).where(eq(schedules.id, SCHEDULE_FAILING)).limit(1);
    expect(schedule?.status).toBe("error");
    expect(schedule?.consecutiveFailures).toBe(3);
    expect(schedule?.lastError).toBeTruthy();
  }, 240_000);

  it("启动失败期间被暂停的任务不会被失败回写重新启用", async () => {
    await insertSchedule({ id: PAUSED_DURING_START_ID });
    startMock.mockImplementationOnce(async () => {
      expect(await updateScheduleStatusAction(PAUSED_DURING_START_ID, "paused")).toEqual({ ok: true });
      throw new Error("模拟工作流启动失败");
    });

    const response = await tick(authedRequest());
    expect((await response.json()).failed).toBe(1);
    const [schedule] = await db.select().from(schedules).where(eq(schedules.id, PAUSED_DURING_START_ID)).limit(1);
    expect(schedule?.status).toBe("paused");
    expect(schedule?.leaseUntil).toBeNull();
  }, 240_000);
});
