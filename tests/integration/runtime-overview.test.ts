import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/runtime/overview/route";
import { RuntimeOverviewInput, RuntimeOverviewResult } from "@/contracts/runtime-overview";
import { runs } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { getRuntimeOverview } from "@/server/queries/runtime-overview";

const ownedRuns: string[] = [];
const workspaceId = randomUUID(), agentId = randomUUID();
const now = new Date("2026-10-09T12:00:00Z");
const input = RuntimeOverviewInput.parse({});
afterEach(async () => { if (ownedRuns.length) await db.delete(runs).where(inArray(runs.id, ownedRuns)); ownedRuns.length = 0; });
async function fixture(overrides: Partial<typeof runs.$inferInsert> = {}) {
  const id = randomUUID(); ownedRuns.push(id);
  await db.insert(runs).values({ id, workspaceId, agentId, versionId: randomUUID(), createdBy: DEMO_USER_ID, createdAt: new Date("2026-10-09T11:00:00Z"), status: "queued", sourceType: "manual", input: {}, ...overrides });
  return id;
}
describe("运行监控真实数据库验收", () => {
  it("当前积压、接收与结束独立分组，失败率不含取消，耗时不含缺失时间", async () => {
    await fixture({ status: "queued", createdAt: new Date("2026-10-01T12:00:00Z") });
    await fixture({ status: "running", sourceType: "evaluation" });
    await fixture({ status: "completed", createdAt: new Date("2026-10-01T12:00:00Z"), sourceType: "schedule", startedAt: new Date("2026-10-09T11:59:58Z"), finishedAt: new Date("2026-10-09T11:59:59Z") });
    await fixture({ status: "failed", startedAt: new Date("2026-10-09T11:59:57Z"), finishedAt: new Date("2026-10-09T11:59:59Z") });
    await fixture({ status: "cancelled", finishedAt: new Date("2026-10-09T11:59:59Z") });
    const result = await getRuntimeOverview(workspaceId, input, now);
    expect(result).toMatchObject({ active: { queued: 1, running: 1, total: 2, oldestQueuedReceivedAgeSeconds: 8 * 86400 },
      received: { total: 3, bySource: { manual: 2, evaluation: 1, schedule: 0 } },
      finished: { total: 3, completed: 1, failed: 1, cancelled: 1, failureRatePercent: 50, knownDurationCount: 2, unknownDurationCount: 1, meanDurationMs: 1500, p95DurationMs: 1950 } });
  });
  it("左闭右开窗口保留数据库微秒，开始边界纳入，结束边界排除", async () => {
    await fixture({ status: "failed", createdAt: new Date("2026-10-08T12:00:00Z"), finishedAt: new Date("2026-10-08T12:00:00Z") });
    await fixture({ status: "completed", createdAt: now, finishedAt: now });
    const justInside = await fixture({ status: "cancelled" });
    await db.update(runs).set({ createdAt: sql`'2026-10-09T11:59:59.999999Z'::timestamptz`, finishedAt: sql`'2026-10-09T11:59:59.999999Z'::timestamptz` }).where(eq(runs.id, justInside));
    expect(await getRuntimeOverview(workspaceId, input, now)).toMatchObject({ received: { total: 2 }, finished: { total: 2, failed: 1, completed: 0, cancelled: 1, failureRatePercent: 100 } });
  });
  it("缺失、倒置和先于接收的开始时间不伪造耗时，未知来源与状态明确计数", async () => {
    await fixture({ status: "completed", startedAt: new Date("2026-10-09T10:59:59Z"), finishedAt: new Date("2026-10-09T11:30:00Z") });
    await fixture({ status: "failed", startedAt: new Date("2026-10-09T11:30:01Z"), finishedAt: new Date("2026-10-09T11:30:00Z") });
    await fixture({ status: "cancelled", finishedAt: new Date("2026-10-09T11:30:00Z") });
    await fixture({ status: "legacy-unknown", sourceType: "legacy-import" });
    expect(await getRuntimeOverview(workspaceId, input, now)).toMatchObject({ received: { total: 4, unknownStatus: 1, bySource: { unknown: 1 } },
      finished: { total: 3, knownDurationCount: 0, unknownDurationCount: 3, meanDurationMs: null, p95DurationMs: null } });
  });
  it("未来排队时间标记未知，微秒年龄不误报，活跃记录带结束时间独立提示", async () => {
    await fixture({ status: "queued", createdAt: new Date("2026-10-09T12:00:01Z") });
    const micro = await fixture({ status: "queued" });
    await db.update(runs).set({ createdAt: sql`'2026-10-09T11:59:59.000123Z'::timestamptz` }).where(eq(runs.id, micro));
    await fixture({ status: "running", finishedAt: new Date("2026-10-09T11:30:00Z") });
    expect(await getRuntimeOverview(workspaceId, input, now)).toMatchObject({ active: { queued: 2, total: 3, queuedTimeUnknown: 1, activeWithEndTime: 1, oldestQueuedReceivedAt: "2026-10-09T11:59:59.000123Z", oldestQueuedReceivedAgeSeconds: 0 } });
  });
  it("工作区、助手与来源筛选先于聚合，另一工作区和同工作区其他助手不串数", async () => {
    await fixture({ status: "waiting_approval", sourceType: "schedule" });
    await fixture({ status: "waiting_event", sourceType: "manual" });
    await fixture({ status: "queued", sourceType: "schedule", agentId: randomUUID() });
    await fixture({ status: "queued", sourceType: "schedule", workspaceId: randomUUID() });
    expect(await getRuntimeOverview(workspaceId, RuntimeOverviewInput.parse({ agentId: agentId.toUpperCase(), sourceType: "schedule" }), now)).toMatchObject({ active: { total: 1, waitingApproval: 1 }, received: { total: 1, bySource: { schedule: 1 } } });
    expect(await getRuntimeOverview(randomUUID(), input, now)).toMatchObject({ active: { total: 0 }, received: { total: 0 }, finished: { total: 0, failureRatePercent: null } });
  });
  it("真实 HTTP 返回严格只读元数据，不泄露或改写任务业务正文", async () => {
    const ownAgent = randomUUID();
    const id = await fixture({ workspaceId: DEMO_WORKSPACE_ID, agentId: ownAgent, createdAt: new Date(Date.now() - 60000), input: { apiKey: "private-monitor-secret", amount: 0 }, context: { private: "monitor-context" } });
    const response = await GET(new Request(`http://localhost/api/runtime/overview?agentId=${ownAgent}&sourceType=manual`));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    const result = RuntimeOverviewResult.parse(await response.json());
    expect(result).toMatchObject({ ok: true, summary: { active: { queued: 1 }, received: { total: 1 } } });
    expect(JSON.stringify(result)).not.toMatch(/private-monitor-secret|monitor-context|workflowRunId/);
    expect((await db.select().from(runs).where(eq(runs.id, id)))[0]).toMatchObject({ status: "queued", input: { apiKey: "private-monitor-secret", amount: 0 }, context: { private: "monitor-context" } });
  });
});
