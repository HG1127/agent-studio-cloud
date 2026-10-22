import { randomUUID } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { defaultResultDeliveries, runs } from "@/db/schema";

type RunRow = typeof runs.$inferSelect;
type DeliveryRow = typeof defaultResultDeliveries.$inferSelect;
type RootHandle = import("workflow/api").Run<unknown>;
type World = Awaited<ReturnType<typeof import("workflow/runtime").getWorld>>;
type RootOutcome = { ok: true; value: unknown } | { ok: false; error: unknown };
type Fixture = {
  runId: string; workspaceId: string; createdBy: string; preparationToken: string;
  handle?: RootHandle; completion?: Promise<RootOutcome>;
  pending: Set<Promise<unknown>>; provedNaturalCompletion: boolean;
  instrumentation?: ReturnType<typeof instrumentDefaultStream>;
};

async function loadDependencies() {
  const [database, schema, orm, api, runtime, testing, fixture, workflowContract, streamContract, streamSdk] = await Promise.all([
    import("@/lib/db"), import("@/db/schema"), import("drizzle-orm"), import("workflow/api"), import("workflow/runtime"),
    import("@workflow/vitest"), import("./default-result-delivery-recovery.workflow"), import("@/contracts/workflow"),
    import("@/contracts/default-result-stream"), import("@/server/services/default-result-stream-sdk"),
  ]);
  return { db: database.db, schema, orm, api, runtime, testing, fixture, workflowContract, streamContract, streamSdk };
}
let dependencies: Awaited<ReturnType<typeof loadDependencies>>;
let isolated = false;
let current: Fixture | undefined;
let cleanupBlocked = false;

// SDK5 Local World plus a migrated, isolated database are required; this source is not executed acceptance evidence.
// The SDK5 helper contract is source-verified at vercel/workflow fe416cb27ec02b31f9c87a365a5d84d35a16048b; runtime acceptance is still unverified.
beforeAll(async () => {
  if (process.env.MVP_ACCEPTANCE_ISOLATED_DB !== "1") throw new Error("仅 CI/CD 专用临时隔离库允许执行成果投递恢复验收");
  dependencies = await loadDependencies();
  isolated = true;
});
beforeEach(() => {
  if (cleanupBlocked) throw new Error("前一恢复夹具未取得自然完成和请求结束证明，保留业务记录并阻断启动下一夹具");
});

function track<T>(fixture: Fixture, operation: Promise<T>): Promise<T> {
  fixture.pending.add(operation);
  void operation.then(() => fixture.pending.delete(operation), () => fixture.pending.delete(operation));
  return operation;
}
function handle(fixture: Fixture): RootHandle {
  if (!fixture.handle) throw new Error("原根启动回执尚未确认，不能推测执行已经停止");
  return fixture.handle;
}
function defaultStreamName(fixture: Fixture) {
  return `${handle(fixture).runId.replace("wrun_", "strm_")}_user`;
}
async function businessRun(fixture: Fixture): Promise<RunRow> {
  const { db, schema, orm } = dependencies;
  const [row] = await db.select().from(schema.runs).where(orm.and(orm.eq(schema.runs.id, fixture.runId), orm.eq(schema.runs.workspaceId, fixture.workspaceId)));
  if (!row) throw new Error("本套件原业务运行不存在");
  return row;
}
async function delivery(fixture: Fixture): Promise<DeliveryRow> {
  const { db, schema, orm } = dependencies;
  const rows = await db.select().from(schema.defaultResultDeliveries).where(orm.and(
    orm.eq(schema.defaultResultDeliveries.runId, fixture.runId), orm.eq(schema.defaultResultDeliveries.workspaceId, fixture.workspaceId),
  ));
  expect(rows).toHaveLength(1);
  return rows[0];
}
async function executionEvidence(fixture: Fixture) {
  const { db, schema, orm } = dependencies;
  const [traces, models, tools, steps] = await Promise.all([
    db.select().from(schema.traceEvents).where(orm.and(orm.eq(schema.traceEvents.workspaceId, fixture.workspaceId), orm.eq(schema.traceEvents.runId, fixture.runId))),
    db.select({ id: schema.modelCalls.id }).from(schema.modelCalls).where(orm.and(orm.eq(schema.modelCalls.workspaceId, fixture.workspaceId), orm.eq(schema.modelCalls.runId, fixture.runId))),
    db.select({ id: schema.toolOperations.id }).from(schema.toolOperations).where(orm.and(orm.eq(schema.toolOperations.workspaceId, fixture.workspaceId), orm.eq(schema.toolOperations.sourceRunId, fixture.runId))),
    db.select({ id: schema.runSteps.id }).from(schema.runSteps).where(orm.and(orm.eq(schema.runSteps.workspaceId, fixture.workspaceId), orm.eq(schema.runSteps.runId, fixture.runId))),
  ]);
  expect(models).toHaveLength(0);
  expect(tools).toHaveLength(0);
  expect(steps).toHaveLength(0);
  expect(traces.filter((trace) => trace.kind === "run.started")).toHaveLength(1);
  expect(traces.filter((trace) => trace.kind === "run.completed")).toHaveLength(1);
  expect(traces).toHaveLength(2);
  return traces.map((trace) => ({ id: trace.id, kind: trace.kind, seq: trace.seq })).sort((left, right) => left.seq - right.seq);
}

async function prepareFixture() {
  const fixture: Fixture = {
    runId: randomUUID(), workspaceId: randomUUID(), createdBy: randomUUID(), preparationToken: `result-recovery-prepare:${randomUUID()}`,
    pending: new Set(), provedNaturalCompletion: false,
  };
  current = fixture;
  const { db, schema, workflowContract, api, testing } = dependencies;
  const agentId = randomUUID();
  const result = { receiptId: `receipt-${randomUUID()}`, amount: 0, approved: false };
  const draft = workflowContract.WorkflowDraft.parse({
    id: `delivery-recovery-${randomUUID()}`, startNodeId: "start", rootAgent: { id: agentId, name: "成果恢复验收助手", role: "受控验收" },
    nodes: { start: { id: "start", title: "收到任务", type: "trigger", next: "done" }, done: { id: "done", title: "结束", type: "end", next: null } },
    variables: [], memoryPolicy: { taskContext: true, longTerm: false }, ui: { positions: {} },
  });
  await db.insert(schema.runs).values({
    id: fixture.runId, workspaceId: fixture.workspaceId, createdBy: fixture.createdBy, agentId, versionId: randomUUID(),
    status: "queued", sourceType: "manual", parentRunId: null, workflowRunId: null, defaultResultTrackingVersion: null,
    input: { inputOnly: "不得进入默认成果流" },
  });
  const root = await track(fixture, api.start(dependencies.fixture.defaultResultDeliveryRecoveryWorkflow, [fixture.runId, draft, result, fixture.preparationToken]));
  fixture.handle = root;
  fixture.completion = track(fixture, root.returnValue.then(
    (value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }),
  ));
  await track(fixture, testing.waitForHook(root, { token: fixture.preparationToken, timeout: 30_000 }));
  const originalRun = await businessRun(fixture), frozen = await delivery(fixture);
  expect(originalRun).toMatchObject({ status: "completed", result, defaultResultTrackingVersion: "sdk5-v1", workflowRunId: root.runId });
  expect(frozen).toMatchObject({ status: "ready", sdkRunId: root.runId, writeAttempts: 0, acknowledgement: "none", producerSettled: true, waitingHookToken: null, waitingHookStepId: null });
  expect(frozen.frozen.frame).toMatchObject({ runId: fixture.runId, result, finishedAt: originalRun.finishedAt!.toISOString() });
  dependencies.streamContract.FrozenDefaultResultFrame.parse(frozen.frozen);
  expect(await track(fixture, root.status)).toBe("running");
  const evidence = await executionEvidence(fixture);
  return { fixture, originalRun, frozen, evidence };
}

function instrumentDefaultStream(fixture: Fixture, world: World, mode: "observation" | "before-write") {
  const originalInfo = world.streams.getInfo.bind(world.streams);
  const originalWrite = world.streams.write.bind(world.streams);
  const originalClose = world.streams.close.bind(world.streams);
  const pending = new Set<Promise<unknown>>();
  const state = { injecting: true, failures: 0, writes: 0, closes: 0, claimedTokens: new Set<string>() };
  const scoped = (runId: string, name: string) => runId === handle(fixture).runId && name === defaultStreamName(fixture);
  function operation<T>(promise: Promise<T>) {
    pending.add(promise);
    void promise.then(() => pending.delete(promise), () => pending.delete(promise));
    return track(fixture, promise);
  }
  const info = vi.spyOn(world.streams, "getInfo").mockImplementation((...args) => {
    if (!scoped(args[0], args[1])) return originalInfo(...args);
    return operation((async () => {
      let fail = state.injecting && mode === "observation";
      if (state.injecting && mode === "before-write") {
        const claimed = await delivery(fixture);
        fail = claimed.status === "sending" && claimed.operation === "write" && claimed.acknowledgement === "unknown" && !claimed.producerSettled;
        if (fail) {
          expect(claimed.operationToken).toBeTruthy();
          expect(claimed.writeAttempts).toBe(1);
          state.claimedTokens.add(claimed.operationToken!);
        }
      }
      if (fail) { state.failures += 1; throw new Error("test-only-default-result-get-info-outage"); }
      return originalInfo(...args);
    })());
  });
  const write = vi.spyOn(world.streams, "write").mockImplementation((...args) => {
    if (!scoped(args[0], args[1])) return originalWrite(...args);
    state.writes += 1;
    return operation(originalWrite(...args));
  });
  const close = vi.spyOn(world.streams, "close").mockImplementation((...args) => {
    if (!scoped(args[0], args[1])) return originalClose(...args);
    state.closes += 1;
    return operation(originalClose(...args));
  });
  return { state, pending, restore: () => { info.mockRestore(); write.mockRestore(); close.mockRestore(); } };
}

async function nextProductionHook(fixture: Fixture, excluded: Set<string>, expectedStatus: "waiting_review" | "ready") {
  const deadline = Date.now() + 30_000;
  let saved: DeliveryRow | undefined;
  await vi.waitFor(async () => {
    const row = await delivery(fixture);
    expect(row.status).toBe(expectedStatus);
    expect(row.waitingHookToken).toBeTruthy();
    expect(row.waitingHookStepId).toBeTruthy();
    expect(excluded.has(row.waitingHookToken!)).toBe(false);
    expect(await track(fixture, handle(fixture).status)).toBe("running");
    saved = row;
  }, { timeout: Math.max(1, deadline - Date.now()), interval: 100 });
  if (!saved?.waitingHookToken || !saved.waitingHookStepId) throw new Error("主流程没有保存可确认的等待入口");
  const hook = await track(fixture, dependencies.testing.waitForHook(handle(fixture), { token: saved.waitingHookToken, timeout: Math.max(1, deadline - Date.now()) }));
  expect(hook.token).toBe(saved.waitingHookToken);
  return saved;
}
async function wake(fixture: Fixture, token: string) {
  await track(fixture, dependencies.api.resumeHook(token, { kind: "delivery-updated" }));
}
async function unchangedExecution(fixture: Fixture, originalRun: RunRow, frozen: DeliveryRow, evidence: Awaited<ReturnType<typeof executionEvidence>>) {
  expect(await businessRun(fixture)).toEqual(originalRun);
  const saved = await delivery(fixture);
  expect(saved.sdkRunId).toBe(handle(fixture).runId);
  expect(saved.frozen).toEqual(frozen.frozen);
  expect(saved.frozen.frame.finishedAt).toBe(originalRun.finishedAt!.toISOString());
  expect(await executionEvidence(fixture)).toEqual(evidence);
}

async function readDefaultFrames(fixture: Fixture) {
  const ops: Promise<unknown>[] = [];
  const readable = handle(fixture).getReadable<unknown>({ startIndex: 0, ops });
  const reader = readable.getReader();
  const frames: unknown[] = [];
  let ended = false;
  try {
    for (let count = 0; count < 3; count += 1) {
      const item = await track(fixture, reader.read());
      if (item.done) { ended = true; break; }
      frames.push(item.value);
    }
    if (!ended) throw new Error("成果流没有在单帧后明确结束，不能清理夹具");
  } finally {
    reader.releaseLock();
    let offset = 0;
    while (offset < ops.length) {
      const batch = ops.slice(offset); offset += batch.length;
      const results = await Promise.allSettled(batch.map((promise) => track(fixture, promise)));
      if (results.some((result) => result.status === "rejected")) throw new Error("SDK 成果读回操作未完整结束，保留业务记录");
    }
    if (!ended) await track(fixture, readable.cancel());
  }
  return frames;
}
async function proveNaturalCompletion(prepared: Awaited<ReturnType<typeof prepareFixture>>, world: World) {
  // This proof covers this linear fixture's awaited SDK producer and tracked calls; returnValue is not a global SDK drain signal.
  const { fixture, originalRun, frozen, evidence } = prepared;
  if (!fixture.completion) throw new Error("原根完成回执不存在，保留业务记录");
  expect(await fixture.completion).toEqual({ ok: true, value: { status: "completed", runId: fixture.runId } });
  expect(await track(fixture, handle(fixture).status)).toBe("completed");
  const saved = await delivery(fixture);
  expect(saved).toMatchObject({ status: "confirmed", acknowledgement: "confirmed", producerSettled: true, writeAttempts: 1 });
  expect(saved.confirmedAt).toBeInstanceOf(Date);
  expect(await track(fixture, world.streams.getInfo(handle(fixture).runId, defaultStreamName(fixture)))).toMatchObject({ done: true, tailIndex: 0 });
  expect(await readDefaultFrames(fixture)).toEqual([frozen.frozen.frame]);
  expect(await track(fixture, dependencies.streamSdk.observeDefaultResultStream({
    owner: { workspaceId: fixture.workspaceId, runId: fixture.runId, sdkRunId: handle(fixture).runId, root: true, frameHash: frozen.frozen.frameHash },
    frozen: frozen.frozen, producerSettled: true,
  }))).toMatchObject({ readStatus: "verified_snapshot", matchedFrames: 1, conflictingFrames: 0, metadata: { done: true, tailIndex: 0 } });
  await unchangedExecution(fixture, originalRun, frozen, evidence);
  expect(fixture.instrumentation!.state.writes).toBe(1);
  expect(fixture.instrumentation!.state.closes).toBeGreaterThanOrEqual(1);
  expect(fixture.instrumentation!.pending.size).toBe(0);
  expect(fixture.pending.size).toBe(0);
  fixture.provedNaturalCompletion = true;
}

afterEach(async () => {
  if (!isolated || !current) return;
  const fixture = current;
  current = undefined;
  try {
    // Failure/cancel/timeout and a cancel ACK never prove a producer stopped; only positive natural completion permits cleanup.
    if (!fixture.provedNaturalCompletion || fixture.pending.size > 0 || (fixture.instrumentation?.pending.size ?? 0) > 0) {
      throw new Error("原根、成果或本测试请求缺少完整自然结束证明");
    }
    expect(await track(fixture, handle(fixture).status)).toBe("completed");
    const confirmed = await delivery(fixture);
    expect(confirmed).toMatchObject({ status: "confirmed", acknowledgement: "confirmed", producerSettled: true });
    expect(confirmed.confirmedAt).toBeInstanceOf(Date);
    expect(fixture.pending.size).toBe(0);
    expect(fixture.instrumentation!.pending.size).toBe(0);
    fixture.instrumentation!.restore();
    const { db, schema, orm } = dependencies;
    await db.transaction(async (tx) => {
      await tx.delete(schema.defaultResultDeliveries).where(orm.and(orm.eq(schema.defaultResultDeliveries.runId, fixture.runId), orm.eq(schema.defaultResultDeliveries.workspaceId, fixture.workspaceId)));
      await tx.delete(schema.traceEvents).where(orm.and(orm.eq(schema.traceEvents.runId, fixture.runId), orm.eq(schema.traceEvents.workspaceId, fixture.workspaceId)));
      await tx.delete(schema.runs).where(orm.and(orm.eq(schema.runs.id, fixture.runId), orm.eq(schema.runs.workspaceId, fixture.workspaceId)));
    });
  } catch {
    cleanupBlocked = true;
    if ((fixture.instrumentation?.pending.size ?? 0) === 0) fixture.instrumentation?.restore();
    throw new Error(`恢复夹具清理已阻断，保留原业务记录 ${fixture.runId}；未取消原根，不以取消回执或终态推测发送已结束`);
  }
});

describe("SDK5 生产成果等待路径的恢复候选验收（真实隔离数据库与公共 World；尚未执行）", () => {
  it("超过默认步骤重试次数的四轮读取故障仍挂在同一原根，新 Hook 恢复后只交付一帧", async () => {
    const prepared = await prepareFixture();
    const { fixture, originalRun, frozen, evidence } = prepared;
    const world = await track(fixture, Promise.resolve(dependencies.runtime.getWorld()));
    const instrumentation = instrumentDefaultStream(fixture, world, "observation");
    fixture.instrumentation = instrumentation;
    await track(fixture, dependencies.api.resumeHook(fixture.preparationToken, true));
    const tokens = new Set<string>(), steps = new Set<string>();
    let pending: DeliveryRow | undefined;
    for (let round = 0; round < 4; round += 1) {
      pending = await nextProductionHook(fixture, tokens, "waiting_review");
      expect(pending).toMatchObject({
        error: "成果流暂时无法完整核对，原流程等待恢复消息", writeAttempts: 0,
        acknowledgement: "none", producerSettled: true, operation: null, operationToken: null, confirmedAt: null,
      });
      expect(pending.error).not.toContain("test-only-default-result-get-info-outage");
      expect(steps.has(pending.waitingHookStepId!)).toBe(false);
      tokens.add(pending.waitingHookToken!); steps.add(pending.waitingHookStepId!);
      expect(instrumentation.state.failures).toBeGreaterThanOrEqual(round + 1);
      expect(instrumentation.state.writes).toBe(0);
      expect(instrumentation.state.closes).toBe(0);
      await unchangedExecution(fixture, originalRun, frozen, evidence);
      if (round < 3) await wake(fixture, pending.waitingHookToken!);
    }
    expect(tokens.size).toBe(4); expect(steps.size).toBe(4);
    expect(instrumentation.state.failures).toBeGreaterThanOrEqual(4);
    instrumentation.state.injecting = false;
    await wake(fixture, pending!.waitingHookToken!);
    await proveNaturalCompletion(prepared, world);
  });

  it("公开 World 在发送前读取失败形成 ACKnone，释放真实领取后等待，再由原根单帧完成", async () => {
    const prepared = await prepareFixture();
    const { fixture, originalRun, frozen, evidence } = prepared;
    const world = await track(fixture, Promise.resolve(dependencies.runtime.getWorld()));
    const instrumentation = instrumentDefaultStream(fixture, world, "before-write");
    fixture.instrumentation = instrumentation;
    await track(fixture, dependencies.api.resumeHook(fixture.preparationToken, true));
    const tokens = new Set<string>(), steps = new Set<string>();
    let pending: DeliveryRow | undefined;
    for (let round = 0; round < 2; round += 1) {
      pending = await nextProductionHook(fixture, tokens, "ready");
      expect(pending).toMatchObject({
        operation: "write", writeAttempts: 0, acknowledgement: "none", producerSettled: true,
        confirmedAt: null, error: "发送尚未开始，稍后可重新核对",
      });
      expect(instrumentation.state.claimedTokens.has(pending.operationToken!)).toBe(true);
      expect(steps.has(pending.waitingHookStepId!)).toBe(false);
      tokens.add(pending.waitingHookToken!); steps.add(pending.waitingHookStepId!);
      expect(instrumentation.state.claimedTokens.size).toBe(round + 1);
      expect(instrumentation.state.writes).toBe(0);
      expect(instrumentation.state.closes).toBe(0);
      await unchangedExecution(fixture, originalRun, frozen, evidence);
      if (round === 0) await wake(fixture, pending.waitingHookToken!);
    }
    expect(tokens.size).toBe(2); expect(steps.size).toBe(2);
    instrumentation.state.injecting = false;
    await wake(fixture, pending!.waitingHookToken!);
    await proveNaturalCompletion(prepared, world);
  });
});
