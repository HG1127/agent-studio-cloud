import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeOverviewInput } from "@/contracts/runtime-overview";
const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { execute: mocks.execute } }));
import { getRuntimeOverview } from "./runtime-overview";
const workspace = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", agentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const now = new Date("2026-10-09T12:00:00Z");
const raw = { queued: "0", running: "0", waitingApproval: "0", waitingEvent: "0", oldestQueuedReceivedAt: null, oldestQueuedReceivedAgeSeconds: null, queuedTimeUnknown: "0", activeWithEndTime: "0", received: "0", receivedUnknownStatus: "0", manual: "0", schedule: "0", agentCall: "0", handoff: "0", evaluation: "0", unknownSource: "0", completed: "0", failed: "0", cancelled: "0", knownDuration: "0", unknownDuration: "0", meanDurationMs: null, p95DurationMs: null };
beforeEach(() => { mocks.execute.mockReset(); mocks.execute.mockResolvedValue([raw]); });
describe("同一快照运行统计查询", () => {
  it("只用一次参数化查询，不读业务正文、回执、密钥或引擎句柄", async () => {
    expect(await getRuntimeOverview(workspace, RuntimeOverviewInput.parse({}), now)).toMatchObject({ assessedAt: now.toISOString(), finished: { failureRatePercent: null } });
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(query.sql).not.toMatch(/"(?:input|output|context|result|error|step_states|workflow_run_id|receipt|payload)"/);
    expect(query.params).toContain(workspace);
    expect(query.sql).not.toContain(workspace);
    expect(query.sql).toContain("percentile_cont(0.95)");
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });
  it("助手和来源筛选在聚合前执行，窗口同时约束接收与结束，不把积压限制为近期", async () => {
    await getRuntimeOverview(workspace, RuntimeOverviewInput.parse({ window: "1h", agentId: agentId.toUpperCase(), sourceType: "schedule" }), now);
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(query.params).toEqual(expect.arrayContaining([workspace, agentId, "schedule", "2026-10-09T11:00:00.000Z", now.toISOString()]));
    expect(query.sql.indexOf('"runs"."agent_id" =')).toBeLessThan(query.sql.indexOf("count(*)"));
    expect(query.sql).toContain('or ("runs"."finished_at"');
    expect(query.sql).toContain("finished_at <");
  });
  it("无效工作区或时间在查询前拒绝，缺失或坏聚合不冒充零数据成功", async () => {
    await expect(getRuntimeOverview("bad", RuntimeOverviewInput.parse({}), now)).rejects.toThrow();
    await expect(getRuntimeOverview(workspace, RuntimeOverviewInput.parse({}), new Date("bad"))).rejects.toThrow();
    expect(mocks.execute).not.toHaveBeenCalled();
    mocks.execute.mockResolvedValue([]);
    await expect(getRuntimeOverview(workspace, RuntimeOverviewInput.parse({}), now)).rejects.toThrow();
    mocks.execute.mockResolvedValue([{ ...raw, received: "2" }]);
    await expect(getRuntimeOverview(workspace, RuntimeOverviewInput.parse({}), now)).rejects.toThrow();
  });
});
