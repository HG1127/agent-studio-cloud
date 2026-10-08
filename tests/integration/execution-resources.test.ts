import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FatalError } from "workflow";
const scope = vi.hoisted(() => ({ workspace: crypto.randomUUID(), start: vi.fn() }));
vi.mock("@/lib/constants", async (original) => ({ ...await original<typeof import("@/lib/constants")>(), DEMO_WORKSPACE_ID: scope.workspace }));
vi.mock("workflow/api", () => ({ start: scope.start }));
import { GET, POST } from "@/app/api/execution/resources/route";
import { AgentManifest } from "@/contracts/manifest";
import { DEFAULT_EXECUTION_RESOURCE_LIMITS, ExecutionPolicyHistoryResult, ExecutionPolicyReadResult, ExecutionPolicyWriteResult, type ExecutionResourceLimits } from "@/contracts/execution-resources";
import { agents, agentVersions, executionPolicies, executionPolicyChanges, modelCalls, runDeliveries, runSteps, runs, traceEvents } from "@/db/schema";
import { DEMO_USER_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { recordExecutionPolicyAction } from "@/server/actions/record-execution-policy";
import { freezeExecutionResources, presentExecutionPolicy } from "@/server/domain/execution-resources";
import { getExecutionResourcePolicy, listExecutionPolicyHistory } from "@/server/queries/execution-resources";
import { beginRunModelCall, settleRunModelCall } from "@/server/services/model-call";
import { startRunCore } from "@/server/services/start-run-core";
const agentId = crypto.randomUUID(), versionId = crypto.randomUUID(), owned: string[] = [];
const limits = { maxConcurrentChains: 1, maxModelCalls: 2, maxChildRuns: 2 };
const manifest = AgentManifest.parse({ schemaVersion: "4.0", workflowFingerprint: "resource-test", inputContract: { fields: [] }, resourceSelection: { model: { modelId: "mock", mock: true } }, designAudit: { status: "passed", issueCount: 0, criticalCount: 0 }, workflowSnapshot: {
  id: "resource-test", startNodeId: "start", rootAgent: { id: agentId, name: "资源测试", role: "测试" }, memoryPolicy: { taskContext: true, longTerm: false }, nodes: { start: { id: "start", title: "开始", type: "trigger", next: "done" }, done: { id: "done", title: "完成", type: "end", next: null } },
} });
beforeEach(async () => {
  scope.start.mockReset().mockImplementation(async () => ({ runId: "wrun_resource_" + crypto.randomUUID() }));
  await db.insert(agents).values({ id: agentId, workspaceId: scope.workspace, createdBy: DEMO_USER_ID, name: "资源测试", intentText: "资源测试", status: "published" });
  await db.insert(agentVersions).values({ id: versionId, agentId, workspaceId: scope.workspace, createdBy: DEMO_USER_ID, version: 1, status: "production", manifest });
});
afterEach(async () => {
  const local = await db.select({ id: runs.id }).from(runs).where(eq(runs.workspaceId, scope.workspace)); owned.push(...local.map((row) => row.id));
  if (owned.length) {
    await db.delete(traceEvents).where(inArray(traceEvents.runId, owned)); await db.delete(runSteps).where(inArray(runSteps.runId, owned));
    await db.delete(runDeliveries).where(inArray(runDeliveries.runId, owned)); await db.delete(runs).where(inArray(runs.id, owned));
  }
  owned.length = 0;
  await db.delete(executionPolicyChanges).where(eq(executionPolicyChanges.workspaceId, scope.workspace)); await db.delete(executionPolicies).where(eq(executionPolicies.workspaceId, scope.workspace));
  await db.delete(agentVersions).where(eq(agentVersions.id, versionId)); await db.delete(agents).where(eq(agents.id, agentId));
});
async function configure(value: ExecutionResourceLimits = limits) { await db.insert(executionPolicies).values({ workspaceId: scope.workspace, createdBy: DEMO_USER_ID, revision: 1, limits: value }); }
async function fixture(parentId: string | null = null, overrides: Partial<typeof runs.$inferInsert> = {}) {
  const id = crypto.randomUUID(); owned.push(id);
  const policy = presentExecutionPolicy({ id: agentId, revision: 1, limits, updatedAt: new Date(), archivedAt: null });
  const [parent] = parentId ? await db.select().from(runs).where(eq(runs.id, parentId)) : [];
  await db.insert(runs).values({ id, workspaceId: scope.workspace, createdBy: DEMO_USER_ID, agentId, versionId, status: "running", input: {}, modelUsageTrackingVersion: "v1", collaborationTrackingVersion: "v1",
    executionRootRunId: parent?.executionRootRunId ?? id, executionResources: parent?.executionResources ?? freezeExecutionResources(policy, "new-root"),
    ...(parentId ? { parentRunId: parentId, sourceType: "agent_call", sourceKey: `agent-call:${parentId}:${id}` } : {}), ...overrides });
  return id;
}
const call = (runId: string) => beginRunModelCall({ runId, nodeId: "work", nodeTitle: "测试处理", modelId: "test-model", connectionId: null });
const change = (expectedRevision: number, value = limits, requestId = crypto.randomUUID()) => ({ requestId, expectedRevision, confirmed: true as const, limits: value, reason: "试点限制 password=private-value" });
describe("资源控制真实数据库并发验收", () => {
  it.each(["manual", "schedule", "evaluation"] as const)("%s 并发新任务只能占一个名额，拒绝请求不建任务、不启动引擎", async (sourceType) => {
    await configure(); const results = await Promise.all([startRunCore({ agentId, input: {}, sourceType, sourceKey: "resource:a" }), startRunCore({ agentId, input: {}, sourceType, sourceKey: "resource:b" })]);
    expect(results.filter((result) => result.ok)).toHaveLength(1); expect(results.find((result) => !result.ok)).toMatchObject({ ok: false, retryable: true, resourceLimit: { kind: "concurrent-chains", current: 1, maximum: 1 } });
    expect(scope.start).toHaveBeenCalledTimes(1);
    const rows = await db.select().from(runs).where(eq(runs.workspaceId, scope.workspace)); expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ executionRootRunId: rows[0].id, executionResources: { coverage: "new-root", policyRevision: 1, limits: { maxModelCalls: 2, maxChildRuns: 2 } } });
    expect(await db.select().from(runDeliveries).where(eq(runDeliveries.workspaceId, scope.workspace))).toHaveLength(0);
  });
  it("并发同一次请求先找回任务，满额度也不重复启动或多占名额", async () => {
    await configure(); const args = { agentId, input: {}, sourceKey: "resource:same" };
    const results = await Promise.all([startRunCore(args), startRunCore(args)]); expect(results.every((result) => result.ok)).toBe(true);
    expect(results[0]).toEqual(results[1]); expect(scope.start).toHaveBeenCalledTimes(1);
    expect(await startRunCore(args)).toEqual(results[0]); expect((await getExecutionResourcePolicy(scope.workspace)).capacity.reservedChains).toBe(1);
  });
  it("根已结束但子仍活跃不提前释放，所有成员结束后新根才可接收", async () => {
    await configure(); const root = await fixture(), child = await fixture(root); await db.update(runs).set({ status: "failed" }).where(eq(runs.id, root));
    expect((await getExecutionResourcePolicy(scope.workspace)).capacity.reservedChains).toBe(1);
    expect(await startRunCore({ agentId, input: {}, sourceKey: "resource:held" })).toMatchObject({ ok: false, resourceLimit: { current: 1 } });
    await expect(call(child)).rejects.toSatisfy(FatalError.is);
    await db.update(runs).set({ status: "completed" }).where(eq(runs.id, child));
    expect(await startRunCore({ agentId, input: {}, sourceKey: "resource:released" })).toMatchObject({ ok: true });
  });
  it("未知状态与历史无关联记录保守占名额，外国工作区不计数", async () => {
    await configure({ ...limits, maxConcurrentChains: 3 }); const root = await fixture(); await fixture(root, { status: "waiting_event" });
    const old = await fixture(null, { status: "unknown-old-state", executionRootRunId: null, executionResources: null }); await fixture(null, { workspaceId: crypto.randomUUID() });
    const before = await db.select().from(runs).where(eq(runs.id, old));
    const response = await GET(new Request("http://localhost/api/execution/resources")); expect(response.status).toBe(200);
    expect(ExecutionPolicyReadResult.parse(await response.json())).toMatchObject({ ok: true, snapshot: { capacity: { reservedChains: 2, untrackedActiveRuns: 1, availableSlots: 1 } } });
    expect(await db.select().from(runs).where(eq(runs.id, old))).toEqual(before);
  });
  it("父子同时登记只消费整链额度，失败与归档不退还，补记不再次收费", async () => {
    const root = await fixture(null, { executionResources: freezeExecutionResources(presentExecutionPolicy({ id: agentId, revision: 1, limits: { ...limits, maxModelCalls: 1 }, updatedAt: new Date(), archivedAt: null }), "new-root") }), child = await fixture(root);
    const results = await Promise.allSettled([call(root), call(child)]); expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult; expect(FatalError.is(rejected.reason)).toBe(true);
    const accepted = results.find((result) => result.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof call>>>;
    const settlement = { ...accepted.value, state: "failed" as const, measurement: null, failure: "provider-unavailable" as const }; await settleRunModelCall(settlement); await settleRunModelCall(settlement);
    await db.update(modelCalls).set({ archivedAt: new Date() }).where(eq(modelCalls.id, accepted.value.id)); await expect(call(root)).rejects.toSatisfy(FatalError.is);
    expect(await db.select().from(modelCalls).where(eq(modelCalls.workspaceId, scope.workspace))).toHaveLength(1);
  });
  it("指向外工作区或缺失根的资源标识不能把多个不可信任务合并成一个名额", async () => {
    await configure({ ...limits, maxConcurrentChains: 3 });
    const foreign = await fixture(null, { workspaceId: crypto.randomUUID() });
    const [foreignRow] = await db.select().from(runs).where(eq(runs.id, foreign));
    await fixture(null, { executionRootRunId: foreign, executionResources: foreignRow.executionResources });
    await fixture(null, { executionRootRunId: foreign, executionResources: foreignRow.executionResources });
    await fixture(null, { executionRootRunId: crypto.randomUUID() });
    expect((await getExecutionResourcePolicy(scope.workspace)).capacity).toEqual({ reservedChains: 3, untrackedActiveRuns: 3, availableSlots: 0 });
    expect(await startRunCore({ agentId, input: {}, sourceKey: "resource:untrusted" })).toMatchObject({ ok: false, resourceLimit: { current: 3, maximum: 3 } });
  });
  it("新设置只改变新链限制，既有链冻结额度不会被缩小或放大", async () => {
    await configure({ ...limits, maxModelCalls: 3 }); const result = await startRunCore({ agentId, input: {}, sourceKey: "resource:frozen" }); expect(result.ok).toBe(true); if (!result.ok) throw new Error("fixture rejected");
    await db.update(runs).set({ status: "running" }).where(eq(runs.id, result.runId)); await call(result.runId);
    expect(await recordExecutionPolicyAction(change(1, { ...limits, maxModelCalls: 1, maxChildRuns: 0 }))).toMatchObject({ ok: true, recordedRevision: 2 });
    await call(result.runId); await call(result.runId); await expect(call(result.runId)).rejects.toSatisfy(FatalError.is);
    const [row] = await db.select().from(runs).where(eq(runs.id, result.runId)); expect(row.executionResources).toMatchObject({ policyRevision: 1, limits: { maxModelCalls: 3, maxChildRuns: 2 } });
  });
  it("历史链按已登记记录采用部分覆盖，归属不回填跟踪声明，也不刷新启动时间", async () => {
    await configure(); const updatedAt = new Date("2026-10-01T12:00:00Z"), root = await fixture(null, { executionRootRunId: null, executionResources: null, updatedAt, collaborationTrackingVersion: null });
    const child = await fixture(root, { sourceKey: `agent-call:${root.toUpperCase()}:legacy`, executionRootRunId: null, executionResources: null, updatedAt, collaborationTrackingVersion: null });
    await call(child); const rows = await db.select().from(runs).where(inArray(runs.id, [root, child]));
    for (const row of rows) expect(row).toMatchObject({ executionRootRunId: root, executionResources: { coverage: "legacy-or-partial", policyRevision: 1 }, collaborationTrackingVersion: null, updatedAt });
  });
  it("关联环、缺失祖先与资源快照损坏阻止新意图，计数不伪报成功", async () => {
    const root = await fixture(), child = await fixture(root); await db.update(runs).set({ sourceType: "handoff", parentRunId: child, sourceKey: `handoff:${child}:cycle` }).where(eq(runs.id, root));
    await expect(call(root)).rejects.toSatisfy(FatalError.is);
    const orphan = await fixture(null, { parentRunId: crypto.randomUUID(), sourceType: "agent_call", sourceKey: `agent-call:${crypto.randomUUID()}:missing` }); await expect(call(orphan)).rejects.toSatisfy(FatalError.is);
    const bad = await fixture(null, { executionResources: {} as typeof runs.$inferInsert.executionResources }); await expect(call(bad)).rejects.toSatisfy(FatalError.is);
    expect(await db.select().from(modelCalls).where(eq(modelCalls.workspaceId, scope.workspace))).toHaveLength(0);
  });
  it("资源设置并发原请求只有一份历史，后来修改后找回不重新施加旧限制", async () => {
    const input = change(0), first = await Promise.all([recordExecutionPolicyAction(input), recordExecutionPolicyAction(input)]); expect(first.every((result) => result.ok)).toBe(true);
    expect(await recordExecutionPolicyAction(change(1, { ...limits, maxModelCalls: 4 }))).toMatchObject({ ok: true, recordedRevision: 2 });
    expect(await recordExecutionPolicyAction(input)).toMatchObject({ ok: true, recordedRevision: 1, policy: { revision: 2, limits: { maxModelCalls: 4 } } });
    expect(await recordExecutionPolicyAction({ ...input, reason: "不同原因" })).toMatchObject({ ok: false, conflict: true });
    const rows = await db.select().from(executionPolicyChanges).where(eq(executionPolicyChanges.workspaceId, scope.workspace)); expect(rows).toHaveLength(2); expect(JSON.stringify(rows)).not.toContain("private-value");
  });
  it("不同请求同时修改同一旧版本只允许一方提交，历史与设置原子一致", async () => {
    const result = await Promise.all([recordExecutionPolicyAction(change(0)), recordExecutionPolicyAction(change(0, { ...limits, maxModelCalls: 4 }))]);
    expect(result.filter((value) => value.ok)).toHaveLength(1); expect(result.find((value) => !value.ok)).toMatchObject({ ok: false, conflict: true });
    const rows = await db.select().from(executionPolicyChanges).where(eq(executionPolicyChanges.workspaceId, scope.workspace)); expect(rows).toHaveLength(1);
    expect((await getExecutionResourcePolicy(scope.workspace)).policy.limits).toEqual(rows[0].limits);
  });
  it("版本历史分页不被后续修改挤入，不返回哈希、创建人或工作区", async () => {
    for (let revision = 0; revision < 3; revision += 1) expect((await recordExecutionPolicyAction(change(revision))).ok).toBe(true);
    const page = ExecutionPolicyHistoryResult.parse(await listExecutionPolicyHistory(scope.workspace, { limit: 2 })); if (!page.ok) throw new Error("history unavailable");
    expect(page.items.map((row) => row.revision)).toEqual([3, 2]); expect(page.nextBeforeRevision).toBe(2);
    await recordExecutionPolicyAction(change(3)); const next = await listExecutionPolicyHistory(scope.workspace, { limit: 2, beforeRevision: 2 });
    expect(next).toMatchObject({ ok: true, items: [{ revision: 1 }], nextBeforeRevision: null }); expect(JSON.stringify(next)).not.toMatch(/requestHash|createdBy|workspaceId|private-value/);
    expect(await listExecutionPolicyHistory(crypto.randomUUID(), { limit: 2 })).toEqual({ ok: true, items: [], nextBeforeRevision: null });
  });
  it("真实设置 HTTP 回执可找回，读取不创建默认设置，坏配置不绕过限制", async () => {
    const before = await GET(new Request("http://localhost/api/execution/resources")); expect(ExecutionPolicyReadResult.parse(await before.json())).toMatchObject({ ok: true, snapshot: { policy: { revision: 0, source: "default", limits: DEFAULT_EXECUTION_RESOURCE_LIMITS } } });
    expect(await db.select().from(executionPolicies).where(eq(executionPolicies.workspaceId, scope.workspace))).toHaveLength(0);
    const input = change(0), request = () => new Request("http://localhost/api/execution/resources", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(input) });
    const first = await POST(request()), replay = await POST(request()); expect(first.status).toBe(200); expect(ExecutionPolicyWriteResult.parse(await first.json())).toEqual(ExecutionPolicyWriteResult.parse(await replay.json()));
    await db.update(executionPolicies).set({ archivedAt: new Date() }).where(eq(executionPolicies.workspaceId, scope.workspace)); expect((await GET(new Request("http://localhost/api/execution/resources"))).status).toBe(503);
    expect(await db.select().from(executionPolicyChanges).where(and(eq(executionPolicyChanges.workspaceId, scope.workspace), eq(executionPolicyChanges.requestId, input.requestId)))).toHaveLength(1);
  });
});
