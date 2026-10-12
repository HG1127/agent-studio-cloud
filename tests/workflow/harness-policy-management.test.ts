import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import type { HarnessPolicySnapshot } from "@/contracts/harness-management";

let db: typeof import("@/lib/db").db;
let harnessPolicies: typeof import("@/db/schema").harnessPolicies, harnessPolicyChanges: typeof import("@/db/schema").harnessPolicyChanges;
let runs: typeof import("@/db/schema").runs, runSteps: typeof import("@/db/schema").runSteps, traceEvents: typeof import("@/db/schema").traceEvents;
let waitForHook: typeof import("@workflow/vitest").waitForHook;
let resumeHook: typeof import("workflow/api").resumeHook, start: typeof import("workflow/api").start;
let saveManagedHarnessPolicy: typeof import("@/server/services/harness-policies").saveManagedHarnessPolicy;
let harnessPolicyManagementProbeWorkflow: typeof import("./harness-policy-management.workflow").harnessPolicyManagementProbeWorkflow;
let isolatedDbReady = false, testReady = false, cleanupBlocked = false;
beforeAll(async () => {
  if (process.env.MVP_ACCEPTANCE_ISOLATED_DB !== "1") throw new Error("运行规则 Workflow 回归只允许在明确标记的 CI 临时隔离库执行");
  ({ db } = await import("@/lib/db"));
  ({ harnessPolicies, harnessPolicyChanges, runs, runSteps, traceEvents } = await import("@/db/schema"));
  ({ saveManagedHarnessPolicy } = await import("@/server/services/harness-policies"));
  ({ waitForHook } = await import("@workflow/vitest"));
  ({ resumeHook, start } = await import("workflow/api"));
  ({ harnessPolicyManagementProbeWorkflow } = await import("./harness-policy-management.workflow"));
  isolatedDbReady = true;
});

let workspaceId: string, createdBy: string;
type ProbeHandle = ReturnType<typeof import("workflow/api").getRun>;
type ProbeProducer = { handle: ProbeHandle | null; terminalObserved: boolean };
const producers: ProbeProducer[] = [], ownedRuns: string[] = [];
const foreignParents: Array<{ id: string; workspaceId: string }> = [];
const empty = { version: 1 as const, rules: [] };
const deny = { version: 1 as const, rules: [{ id: "deny-ai", effect: "deny" as const, when: { nodeType: "ai" as const } }] };
const node = WorkflowNode.parse({ id: "target_ai", type: "ai", title: "规则检查目标" });
const draft = WorkflowDraft.parse({ id: "harness-probe", startNodeId: "start", rootAgent: { id: "probe", name: "规则测试助手", role: "测试" },
  memoryPolicy: { taskContext: true, longTerm: false },
  nodes: { start: { id: "start", type: "trigger", title: "开始", next: "target_ai" }, target_ai: { ...node, next: "done" }, done: { id: "done", type: "end", title: "结束" } } });
beforeEach(() => {
  testReady = false;
  if (!isolatedDbReady || cleanupBlocked) throw new Error("隔离环境或上一批后台请求停止证据尚未确认，停止后续运行规则回归");
  workspaceId = randomUUID(); createdBy = randomUUID(); vi.stubEnv("HARNESS_POLICY_JSON", ""); testReady = true;
});
afterEach(async () => {
  if (!isolatedDbReady || !testReady) return;
  if (producers.length > 0) {
    cleanupBlocked = true;
    vi.unstubAllEnvs();
    throw new Error("运行规则回归已尝试启动 SDK，根终态观察不是全部后台请求停止证据；禁止删除本批记录，清理阻断待 CI 核对隔离进程完全结束后统一处理");
  }
  if (ownedRuns.length) {
    await db.delete(traceEvents).where(and(eq(traceEvents.workspaceId, workspaceId), inArray(traceEvents.runId, ownedRuns)));
    await db.delete(runSteps).where(and(eq(runSteps.workspaceId, workspaceId), inArray(runSteps.runId, ownedRuns)));
    await db.delete(runs).where(and(eq(runs.workspaceId, workspaceId), inArray(runs.id, ownedRuns)));
  }
  await db.delete(harnessPolicyChanges).where(eq(harnessPolicyChanges.workspaceId, workspaceId));
  await db.delete(harnessPolicies).where(eq(harnessPolicies.workspaceId, workspaceId));
  for (const parent of foreignParents) await db.delete(runs).where(and(eq(runs.id, parent.id), eq(runs.workspaceId, parent.workspaceId)));
  ownedRuns.length = 0; producers.length = 0; foreignParents.length = 0; vi.unstubAllEnvs();
});
function observeProducerReturn<T>(producer: ProbeProducer, handle: ProbeHandle, returnValue: Promise<T>): Promise<T> {
  const completion = (async () => {
    try {
      const value = await returnValue; producer.terminalObserved = true; return value;
    } catch (error) {
      try { if (await handle.status === "failed") producer.terminalObserved = true; } catch { /* 状态不可读保留未确认，不覆盖原失败。 */ }
      throw error;
    }
  })();
  // 只记录根终态供断言，不能证明 DB、stream 和 continuation 后台请求已经停止。
  void completion.catch(() => undefined);
  return completion;
}
async function startProbe(args: Parameters<typeof harnessPolicyManagementProbeWorkflow>[0]) {
  const producer: ProbeProducer = { handle: null, terminalObserved: false };
  producers.push(producer);
  // start 接受后丢 ACK 也可能已建立 SDK 运行，必须在调用前登记未知生产者。
  const handle = await start(harnessPolicyManagementProbeWorkflow, [args]); producer.handle = handle;
  return { handle, returnValue: observeProducerReturn(producer, handle, handle.returnValue) };
}
async function save(policy: typeof empty | typeof deny | null, expectedRevision = 0) {
  return saveManagedHarnessPolicy({ requestId: randomUUID(), expectedRevision, confirmed: true, policy, reason: "隔离实际 Workflow 验收" }, workspaceId, createdBy);
}
async function insertRun(overrides: Partial<typeof runs.$inferInsert> = {}) {
  const id = randomUUID(); ownedRuns.push(id);
  await db.insert(runs).values({ id, workspaceId, createdBy, agentId: randomUUID(), versionId: randomUUID(), status: "queued", ...overrides });
  return id;
}
async function begin(runId: string, options: { legacyGuardOnly?: boolean; injectRetry?: boolean } = {}) {
  const token = `harness-probe:${randomUUID()}`;
  const { handle, returnValue } = await startProbe({ runId, draft, node, token, ...options });
  await waitForHook(handle, { token }); return { handle, token, returnValue };
}
async function runSnapshot(id: string) {
  const [row] = await db.select({ snapshot: runs.harnessPolicySnapshot }).from(runs).where(and(eq(runs.id, id), eq(runs.workspaceId, workspaceId)));
  return row.snapshot;
}

// 源码待中央迁移和 SDK 全量验收；从未在此分支执行。
describe("真实 Workflow 的规则冻结与暂停恢复", () => {
  it("暂停期间清空当前规则不会放开已冻结拒绝", async () => {
    await save(deny); const id = await insertRun(), probe = await begin(id), snapshot = await runSnapshot(id);
    expect(snapshot).toMatchObject({ revision: 1, policy: deny });
    await save(null, 1); await resumeHook(probe.token, true);
    await expect(probe.returnValue).rejects.toThrow();
    expect(await runSnapshot(id)).toEqual(snapshot);
    const steps = await db.select().from(runSteps).where(eq(runSteps.runId, id));
    expect(steps).toHaveLength(1); expect(steps[0]).toMatchObject({ status: "failed", output: null });
  });
  it("后来新增拒绝不追溯父任务，新子任务继承实际父快照", async () => {
    await save(empty); const parentId = await insertRun(), parent = await begin(parentId), snapshot = await runSnapshot(parentId);
    await save(deny, 1); const childId = await insertRun({ parentRunId: parentId, sourceType: "agent_call" }), child = await begin(childId);
    expect(await runSnapshot(childId)).toEqual(snapshot);
    await resumeHook(child.token, true); await expect(child.returnValue).resolves.toMatchObject({ guarded: true });
    await resumeHook(parent.token, true); await expect(parent.returnValue).resolves.toMatchObject({ guarded: true });
  });
  it("历史空快照及子任务不采用当前拒绝配置", async () => {
    await save(deny); const parentId = await insertRun({ status: "running" }), parent = await begin(parentId, { legacyGuardOnly: true });
    const childId = await insertRun({ parentRunId: parentId, sourceType: "handoff" }), child = await begin(childId);
    expect(await runSnapshot(parentId)).toBeNull(); expect(await runSnapshot(childId)).toBeNull();
    await resumeHook(child.token, true); await expect(child.returnValue).resolves.toMatchObject({ guarded: true });
    await resumeHook(parent.token, true); await expect(parent.returnValue).resolves.toMatchObject({ guarded: true });
  });
  it("跨工作区或缺父在冻结事务失败，不提交 SDK 绑定或启动标记", async () => {
    const foreignWorkspace = randomUUID(), foreign = randomUUID();
    await db.insert(runs).values({ id: foreign, workspaceId: foreignWorkspace, createdBy, agentId: randomUUID(), versionId: randomUUID(), status: "running" });
    foreignParents.push({ id: foreign, workspaceId: foreignWorkspace });
    for (const parentRunId of [foreign, randomUUID()]) {
      const id = await insertRun({ parentRunId, sourceType: "agent_call" });
      const { returnValue } = await startProbe({ runId: id, draft, node, token: `harness-probe:${randomUUID()}` });
      await expect(returnValue).rejects.toThrow();
      const [row] = await db.select().from(runs).where(eq(runs.id, id));
      expect(row).toMatchObject({ status: "queued", workflowRunId: null, harnessPolicySnapshot: null, startedAt: null });
    }
  });
  it("管理员后来拒绝仍优先，坏冻结内容永久停止而不泄露正文", async () => {
    await save(empty); const id = await insertRun(), probe = await begin(id);
    vi.stubEnv("HARNESS_POLICY_JSON", JSON.stringify({ version: 1, rules: [{ id: "deny", effect: "deny", when: {}, reason: "password=private-password" }] }));
    await resumeHook(probe.token, true); await expect(probe.returnValue).rejects.toThrow();
    const events = await db.select().from(traceEvents).where(eq(traceEvents.runId, id)); expect(JSON.stringify(events)).not.toContain("private-password");
    vi.stubEnv("HARNESS_POLICY_JSON", ""); const invalid = await insertRun({ status: "running", harnessPolicySnapshot: { version: 2 } as unknown as HarnessPolicySnapshot });
    const invalidProbe = await begin(invalid, { legacyGuardOnly: true });
    await resumeHook(invalidProbe.token, true); await expect(invalidProbe.returnValue).rejects.toThrow();
  });
  it("真实 SDK 重试后只使用原冻结内容，业务检查仅在成功尝试通过", async () => {
    await save(empty); const id = await insertRun(), probe = await begin(id, { injectRetry: true }), snapshot = await runSnapshot(id);
    await save(deny, 1); await resumeHook(probe.token, true);
    const result = await probe.returnValue; expect(result).toMatchObject({ guarded: true }); expect(result.attempt).toBeGreaterThanOrEqual(2);
    expect(await runSnapshot(id)).toEqual(snapshot);
    const steps = await db.select().from(runSteps).where(eq(runSteps.runId, id)); expect(steps).toHaveLength(1); expect(steps[0].status).toBe("succeeded");
  });
});
