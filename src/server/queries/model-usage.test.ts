import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { execute: mocks.execute } }));
import { getRunModelUsage } from "./model-usage";
const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", workspaceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const now = new Date("2026-10-09T12:00:00Z");
const row = { runId, trackingVersion: "v1", calls: "0", pending: "0", returned: "0", failed: "0", completeCalls: "0", invalidUsageCalls: "0", inputCalls: "0", outputCalls: "0", knownInputTokens: null, knownOutputTokens: null, knownCallTotalTokens: null };
beforeEach(() => { mocks.execute.mockReset().mockResolvedValue([row]); });
describe("当前运行的逐次模型用量查询", () => {
  it("单次参数化快照限定任务和工作区，不读业务正文、节点结果或密钥", async () => {
    expect(await getRunModelUsage(workspaceId.toUpperCase(), runId.toUpperCase(), now)).toMatchObject({ runId, tracking: "tracked-v1", assessedAt: now.toISOString(), calls: { total: 0 }, usage: { knownCallTotalTokens: null, recordedUsageComplete: true } });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(query.params).toEqual(expect.arrayContaining([runId, workspaceId]));
    expect(query.sql).not.toContain(runId); expect(query.sql).not.toContain(workspaceId);
    expect(query.sql).not.toMatch(/"(?:input|output|context|result|error|step_states|workflow_run_id|api_key_ciphertext)"|run_steps/);
    expect(query.sql).toContain("c.workspace_id = r.workspace_id");
    expect(query.sql).not.toContain("archived_at");
  });
  it("历史零记录不虚报完整覆盖，部分报告只汇总已知量", async () => {
    mocks.execute.mockResolvedValue([{ ...row, trackingVersion: null }]);
    expect(await getRunModelUsage(workspaceId, runId, now)).toMatchObject({ tracking: "legacy-or-partial", usage: { recordedUsageComplete: false, knownInputTokens: null } });
    mocks.execute.mockResolvedValue([{ ...row, calls: "3", returned: "1", failed: "1", pending: "1", inputCalls: "1", knownInputTokens: "0" }]);
    expect(await getRunModelUsage(workspaceId, runId, now)).toMatchObject({ calls: { total: 3, returned: 1, failed: 1, pending: 1 }, usage: { incompleteCalls: 3, knownInputTokens: 0, knownOutputTokens: null, recordedUsageComplete: false } });
  });
  it("无效范围与时刻在数据库前拒绝，不存在返回空，坏聚合和溢出明确失败", async () => {
    await expect(getRunModelUsage("bad", runId, now)).rejects.toThrow();
    await expect(getRunModelUsage(workspaceId, "bad", now)).rejects.toThrow();
    await expect(getRunModelUsage(workspaceId, runId, new Date("bad"))).rejects.toThrow();
    expect(mocks.execute).not.toHaveBeenCalled();
    mocks.execute.mockResolvedValue([]); expect(await getRunModelUsage(workspaceId, runId, now)).toBeNull();
    for (const invalid of [{ ...row, calls: "1" }, { ...row, returned: "9007199254740992" }, { ...row, knownInputTokens: "0" }]) {
      mocks.execute.mockResolvedValue([invalid]); await expect(getRunModelUsage(workspaceId, runId, now)).rejects.toThrow();
    }
  });
});
