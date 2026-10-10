import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("workflow", async (original) => ({ ...await original<typeof import("workflow")>(), getWorkflowMetadata: () => ({ workflowRunId: "wrun_model_usage_test" }) }));
import { FatalError } from "workflow";
import { GET } from "@/app/api/runs/[runId]/usage/route";
import { ModelCallSettlement, RunModelUsageResult } from "@/contracts/model-usage";
import { WorkflowDraft } from "@/contracts/workflow";
import { modelCalls, runs, traceEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { readReportedModelUsage } from "@/server/domain/model-usage";
import { getRunModelUsage } from "@/server/queries/model-usage";
import { beginRunModelCall, settleRunModelCall } from "@/server/services/model-call";
import { initializeRun } from "@/server/steps/run-state";

const ownedRuns: string[] = [], workspaceId = randomUUID(), creatorId = randomUUID();
const now = new Date("2026-10-09T12:00:00Z");
const measurement = readReportedModelUsage({ inputTokens: { total: 12, cacheRead: 4 }, outputTokens: { total: 6, reasoning: 2 } });
const reference = (runId: string) => ({ runId, nodeId: "extract", nodeTitle: "提取金额", modelId: "test-model", connectionId: null });
afterEach(async () => {
  if (ownedRuns.length) {
    await db.delete(traceEvents).where(inArray(traceEvents.runId, ownedRuns));
    await db.delete(runs).where(inArray(runs.id, ownedRuns));
  }
  ownedRuns.length = 0;
});
async function fixture(overrides: Partial<typeof runs.$inferInsert> = {}) {
  const id = randomUUID(); ownedRuns.push(id);
  await db.insert(runs).values({ id, workspaceId, createdBy: creatorId, agentId: randomUUID(), versionId: randomUUID(), status: "running", input: {}, modelUsageTrackingVersion: "v1", ...overrides });
  return id;
}
async function returned(runId: string, usage = measurement) {
  const identity = await beginRunModelCall(reference(runId));
  await settleRunModelCall({ ...identity, state: "returned", measurement: usage, failure: null });
  return identity;
}
describe("逐次模型账本真实数据库验收", () => {
  it("重复和并发调用建立独立意图，归属只从任务派生，元数据脱敏", async () => {
    const id = await fixture();
    const entries = await Promise.all([beginRunModelCall(reference(id)), beginRunModelCall(reference(id)), beginRunModelCall({ ...reference(id), nodeTitle: "authorization: Bearer private-label-token", modelId: "api_key=private-model-token" })]);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(3);
    const [run] = await db.select().from(runs).where(eq(runs.id, id));
    const rows = await db.select().from(modelCalls).where(eq(modelCalls.runId, id));
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(row).toMatchObject({ workspaceId, createdBy: creatorId, agentId: run.agentId, versionId: run.versionId, state: "pending", measurement: null, failure: null, finishedAt: null });
    expect(JSON.stringify(rows)).not.toMatch(/private-label-token|private-model-token/);
    await expect(beginRunModelCall({ ...reference(id), workspaceId: randomUUID() } as ReturnType<typeof reference>)).rejects.toThrow();
    expect(await getRunModelUsage(workspaceId, id, now)).toMatchObject({ calls: { total: 3, pending: 3 }, usage: { incompleteCalls: 3, knownCallTotalTokens: null, recordedUsageComplete: false } });
  });
  it.each(["queued", "waiting_approval", "waiting_event", "completed", "failed", "cancelled"])("%s 任务不能发起新模型调用", async (status) => {
    const id = await fixture({ status }), before = await db.select().from(runs).where(eq(runs.id, id));
    const rejected = beginRunModelCall(reference(id));
    await expect(rejected).rejects.toThrow("不能发起模型调用");
    await expect(rejected).rejects.toSatisfy(FatalError.is);
    expect(await db.select().from(modelCalls).where(eq(modelCalls.runId, id))).toHaveLength(0);
    expect(await db.select().from(runs).where(eq(runs.id, id))).toEqual(before);
  });
  it("不存在的任务不能建意图，同一结果并发补记幂等且不刷新完成时间", async () => {
    await expect(beginRunModelCall(reference(randomUUID()))).rejects.toThrow("不能发起模型调用");
    const id = await fixture(), identity = await beginRunModelCall(reference(id));
    const value = ModelCallSettlement.parse({ ...identity, state: "returned", measurement, failure: null });
    await Promise.all([settleRunModelCall(value), settleRunModelCall(value)]);
    const [before] = await db.select().from(modelCalls).where(eq(modelCalls.id, identity.id));
    await settleRunModelCall(value);
    const [after] = await db.select().from(modelCalls).where(eq(modelCalls.id, identity.id));
    expect(after).toEqual(before); expect(after.finishedAt).not.toBeNull();
    await expect(settleRunModelCall({ ...identity, state: "failed", measurement: null, failure: "unknown" })).rejects.toThrow("不能覆盖");
    await expect(settleRunModelCall({ ...value, measurement: readReportedModelUsage({ inputTokens: { total: 13 }, outputTokens: { total: 6 } }) })).rejects.toThrow("不能覆盖");
    expect(await getRunModelUsage(workspaceId, id, now)).toMatchObject({ calls: { total: 1, returned: 1 }, usage: { knownCallTotalTokens: 18, recordedUsageComplete: true } });
  });
  it("不同终态并发竞争只有一个成功，任务取消后仍可补记已开始调用的真实结果", async () => {
    const id = await fixture(), identity = await beginRunModelCall(reference(id));
    const results = await Promise.allSettled([settleRunModelCall({ ...identity, state: "returned", measurement, failure: null }), settleRunModelCall({ ...identity, state: "failed", measurement: null, failure: "unknown" })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const late = await beginRunModelCall(reference(id));
    await db.update(runs).set({ status: "cancelled" }).where(eq(runs.id, id));
    await settleRunModelCall({ ...late, state: "returned", measurement, failure: null });
    const [run] = await db.select().from(runs).where(eq(runs.id, id)); expect(run.status).toBe("cancelled");
    const [row] = await db.select().from(modelCalls).where(eq(modelCalls.id, late.id)); expect(row.state).toBe("returned");
  });
  it("跨工作区、错任务的补记拒绝，混入另一工作区的账本不进入汇总", async () => {
    const id = await fixture(), other = await fixture(), identity = await beginRunModelCall(reference(id));
    await expect(settleRunModelCall({ ...identity, workspaceId: randomUUID(), state: "returned", measurement, failure: null })).rejects.toThrow("不能覆盖");
    await expect(settleRunModelCall({ ...identity, runId: other, state: "returned", measurement, failure: null })).rejects.toThrow("不能覆盖");
    await db.insert(modelCalls).values({ workspaceId: randomUUID(), createdBy: creatorId, runId: id, agentId: randomUUID(), versionId: randomUUID(), nodeId: "foreign", nodeTitle: "其他工作区", modelId: "test", state: "returned", measurement });
    expect(await getRunModelUsage(workspaceId, id, now)).toMatchObject({ calls: { total: 1, pending: 1, returned: 0 } });
    expect(await getRunModelUsage(randomUUID(), id, now)).toBeNull();
    expect(await getRunModelUsage(workspaceId, randomUUID(), now)).toBeNull();
  });
  it("缺失、无效、失败和待确认保持未知，归档不隐藏已发生用量，细分不重复相加", async () => {
    const id = await fixture(), complete = await returned(id);
    await db.update(modelCalls).set({ archivedAt: now }).where(eq(modelCalls.id, complete.id));
    await returned(id, readReportedModelUsage({ inputTokens: { total: 0 }, outputTokens: {} }));
    await returned(id, readReportedModelUsage({ inputTokens: { total: -1 }, outputTokens: { total: 2 } }));
    const failed = await beginRunModelCall(reference(id)); await settleRunModelCall({ ...failed, state: "failed", measurement: null, failure: "provider-unavailable" });
    await beginRunModelCall(reference(id));
    expect(await getRunModelUsage(workspaceId, id, now)).toMatchObject({ calls: { total: 5, returned: 3, failed: 1, pending: 1 }, usage: { completeCalls: 1, incompleteCalls: 4, invalidUsageCalls: 1, inputCalls: 2, outputCalls: 2, knownInputTokens: 12, knownOutputTokens: 8, knownCallTotalTokens: 18, recordedUsageComplete: false } });
  });
  it("历史覆盖与真实零用量分开，初始化只标记新启动的运行，重入不回填历史", async () => {
    const legacy = await fixture({ modelUsageTrackingVersion: null, workflowRunId: "wrun_model_usage_test" }), queued = await fixture({ status: "queued", modelUsageTrackingVersion: null });
    const draft = WorkflowDraft.parse({ id: "usage-test", startNodeId: "start", rootAgent: { id: "test", name: "测试", role: "测试" }, nodes: { start: { id: "start", title: "开始", type: "trigger", next: "done" }, done: { id: "done", title: "完成", type: "end", next: null } }, memoryPolicy: { taskContext: true, longTerm: false } });
    await initializeRun(legacy, draft); await initializeRun(queued, draft);
    expect(await getRunModelUsage(workspaceId, legacy, now)).toMatchObject({ tracking: "legacy-or-partial", usage: { recordedUsageComplete: false, knownCallTotalTokens: null } });
    expect(await getRunModelUsage(workspaceId, queued, now)).toMatchObject({ tracking: "tracked-v1", calls: { total: 0 }, usage: { recordedUsageComplete: true, knownCallTotalTokens: null } });
    await returned(queued, readReportedModelUsage({ inputTokens: { total: 0 }, outputTokens: { total: 0 } }));
    expect(await getRunModelUsage(workspaceId, queued, now)).toMatchObject({ usage: { knownInputTokens: 0, knownOutputTokens: 0, knownCallTotalTokens: 0, recordedUsageComplete: true } });
  });
  it("超过安全整数的累计不截断，接口不泄露正文也不改写业务状态", async () => {
    const id = await fixture({ workspaceId: DEMO_WORKSPACE_ID, input: { secret: "private-usage-input" }, context: { private: "private-usage-context" } });
    await returned(id);
    const request = new Request(`http://localhost/api/runs/${id}/usage`), context = { params: Promise.resolve({ runId: id }) };
    const response = await GET(request, context); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json(); expect(RunModelUsageResult.parse(body)).toMatchObject({ ok: true, summary: { runId: id, usage: { knownCallTotalTokens: 18 } } });
    expect(JSON.stringify(body)).not.toMatch(/private-usage|nodeTitle|workspaceId|createdBy|measurement|failure/);
    const [run] = await db.select().from(runs).where(eq(runs.id, id)); expect(run).toMatchObject({ status: "running", input: { secret: "private-usage-input" }, context: { private: "private-usage-context" } });
    const huge = readReportedModelUsage({ inputTokens: { total: Number.MAX_SAFE_INTEGER }, outputTokens: { total: 0 } });
    await returned(id, huge);
    await expect(getRunModelUsage(DEMO_WORKSPACE_ID, id, now)).rejects.toThrow();
    const unavailable = await GET(request, context); expect(unavailable.status).toBe(503); expect(await unavailable.text()).not.toContain("private-usage");
    const foreign = await fixture(); expect((await GET(new Request(`http://localhost/api/runs/${foreign}/usage`), { params: Promise.resolve({ runId: foreign }) })).status).toBe(404);
  });
});
