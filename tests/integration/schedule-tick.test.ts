import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentManifest } from "@/contracts/manifest";
import { agentVersions, agents, runs, schedules } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { POST as tick } from "@/app/api/schedules/tick/route";
import { listScheduleableAgents } from "@/server/queries/schedules";

const AGENT_ID = "00000000-0000-4000-8000-0000000000e9";
const VERSION_ID = "00000000-0000-4000-8000-0000000000ea";
const SCHEDULE_DUE = "00000000-0000-4000-8000-0000000000eb";
const SCHEDULE_ONCE = "00000000-0000-4000-8000-0000000000ec";
const SCHEDULE_PAUSED = "00000000-0000-4000-8000-0000000000ed";
const SCHEDULE_FAILING = "00000000-0000-4000-8000-0000000000ee";
const DRAFT_AGENT_ID = "00000000-0000-4000-8000-0000000000ef";

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
  await db.insert(agents).values({ id: AGENT_ID, workspaceId: DEMO_WORKSPACE_ID, name: "定时测试助手", intentText: "定时触发的测试助手", createdBy: DEMO_USER_ID });
  await db.insert(agents).values({ id: DRAFT_AGENT_ID, workspaceId: DEMO_WORKSPACE_ID, name: "未发布测试助手", intentText: "尚未发布的测试助手", createdBy: DEMO_USER_ID });
  await db.insert(agentVersions).values({ id: VERSION_ID, agentId: AGENT_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, version: 1, status: "production", manifest });
});

afterAll(async () => {
  await db.delete(runs).where(eq(runs.agentId, AGENT_ID));
  await db.delete(schedules).where(inArray(schedules.id, [SCHEDULE_DUE, SCHEDULE_ONCE, SCHEDULE_PAUSED, SCHEDULE_FAILING]));
  await db.delete(agentVersions).where(eq(agentVersions.agentId, AGENT_ID));
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
});
