import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RESULT_TRACKING_VERSION } from "@/contracts/default-result-delivery";
import { DefaultResultStreamObservation, type FrozenDefaultResultFrame } from "@/contracts/default-result-stream";
import { defaultResultDeliveries, modelCalls, runs, toolOperations } from "@/db/schema";
import { classifyDefaultResultFrame, freezeDefaultResultFrame } from "@/server/domain/runtime/default-result-stream";
import type { DefaultResultStreamSdkInput, DefaultResultStreamSdkMutationInput } from "@/server/services/default-result-stream-sdk";

const mocks = vi.hoisted(() => {
  class DefaultResultStreamSdkError extends Error {
    constructor(readonly code: string, message: string, readonly acknowledgement: "none" | "unknown" | "confirmed" = "none") {
      super(message);
      this.name = "DefaultResultStreamSdkError";
    }
  }
  return {
    workspaceId: crypto.randomUUID(), createdBy: crypto.randomUUID(), DefaultResultStreamSdkError,
    observe: vi.fn<(input: DefaultResultStreamSdkInput) => Promise<DefaultResultStreamObservation>>(),
    write: vi.fn<(input: DefaultResultStreamSdkMutationInput) => Promise<DefaultResultStreamObservation>>(),
    close: vi.fn<(input: DefaultResultStreamSdkMutationInput) => Promise<DefaultResultStreamObservation>>(),
    cancel: vi.fn(), appendTrace: vi.fn(), metadata: vi.fn(), createHook: vi.fn(), model: vi.fn(), tool: vi.fn(),
  };
});
vi.mock("@/lib/constants", async (original) => ({
  ...await original<typeof import("@/lib/constants")>(), DEMO_WORKSPACE_ID: mocks.workspaceId, DEMO_USER_ID: mocks.createdBy,
}));
vi.mock("@/server/services/default-result-stream-sdk", () => ({
  observeDefaultResultStream: mocks.observe, writeDefaultResultStreamFrame: mocks.write,
  closeDefaultResultStream: mocks.close, DefaultResultStreamSdkError: mocks.DefaultResultStreamSdkError,
}));
vi.mock("@/server/services/cancel-workflow-run", () => ({ cancelWorkflowRunIfPresent: mocks.cancel }));
vi.mock("workflow", async (original) => ({
  ...await original<typeof import("workflow")>(), getWorkflowMetadata: mocks.metadata, createHook: mocks.createHook,
}));
vi.mock("@/server/steps/trace-step", () => ({ appendTrace: mocks.appendTrace }));
vi.mock("@/server/steps/model-step", () => ({ runModelStep: mocks.model }));
vi.mock("@/server/steps/tool-step", () => ({ runToolStep: mocks.tool }));
vi.mock("@/server/tools/invoke-tool", () => ({ invokeRegisteredTool: mocks.tool }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

let db: typeof import("@/lib/db").db;
let completeRunResult: typeof import("@/server/services/complete-run-result").completeRunResult;
let deliverDefaultResult: typeof import("@/server/services/default-result-delivery").deliverDefaultResult;
let readDefaultResultDelivery: typeof import("@/server/services/default-result-delivery").readDefaultResultDelivery;
let prepareDefaultResultDeliveryWait: typeof import("@/server/services/default-result-delivery").prepareDefaultResultDeliveryWait;
let finalizeRun: typeof import("@/server/steps/run-state").finalizeRun;
let cancelRunAction: typeof import("@/server/actions/cancel-run").cancelRunAction;
let isolatedDbAccepted = false;
const runIds: string[] = [];
const sdkRunIds = new Map<string, string | null>();
type MockStream = { frames: FrozenDefaultResultFrame["frame"][]; done: boolean };
const streams = new Map<string, MockStream>();

beforeAll(async () => {
  if (process.env.MVP_ACCEPTANCE_ISOLATED_DB !== "1") throw new Error("仅 CI/CD 专用临时隔离库允许执行成果投递数据库验收");
  isolatedDbAccepted = true;
  // Guard precedes database/service imports so a rejected suite cannot open a connection or clean up data.
  const [database, completion, delivery, state, cancellation] = await Promise.all([
    import("@/lib/db"), import("@/server/services/complete-run-result"), import("@/server/services/default-result-delivery"),
    import("@/server/steps/run-state"), import("@/server/actions/cancel-run"),
  ]);
  db = database.db;
  completeRunResult = completion.completeRunResult;
  deliverDefaultResult = delivery.deliverDefaultResult;
  readDefaultResultDelivery = delivery.readDefaultResultDelivery;
  prepareDefaultResultDeliveryWait = delivery.prepareDefaultResultDeliveryWait;
  finalizeRun = state.finalizeRun;
  cancelRunAction = cancellation.cancelRunAction;
});

function stream(runId: string): MockStream {
  let value = streams.get(runId);
  if (!value) { value = { frames: [], done: false }; streams.set(runId, value); }
  return value;
}
function observation(input: DefaultResultStreamSdkInput, changes: Partial<DefaultResultStreamObservation> = {}) {
  const value = stream(input.owner.runId);
  const matchedFrames = value.frames.filter((frame) => classifyDefaultResultFrame(input.frozen, frame) === "match").length;
  return DefaultResultStreamObservation.parse({
    workspaceId: input.owner.workspaceId, runId: input.owner.runId, sdkRunId: input.owner.sdkRunId, frameHash: input.owner.frameHash,
    metadata: { done: value.done, tailIndex: value.frames.length - 1 }, readStatus: "verified_snapshot",
    matchedFrames, conflictingFrames: value.frames.length - matchedFrames, producerSettled: input.producerSettled, ...changes,
  });
}
beforeEach(() => {
  mocks.observe.mockReset().mockImplementation(async (input) => observation(input));
  mocks.write.mockReset().mockImplementation(async (input) => {
    stream(input.owner.runId).frames.push(structuredClone(input.frozen.frame));
    return observation(input);
  });
  mocks.close.mockReset().mockImplementation(async (input) => {
    stream(input.owner.runId).done = true;
    return observation(input);
  });
  mocks.cancel.mockReset().mockResolvedValue("cancelled");
  mocks.appendTrace.mockReset().mockResolvedValue(undefined);
  mocks.metadata.mockReset();
  mocks.createHook.mockReset().mockImplementation(() => { throw new Error("数据库等待入口登记不得直接创建引擎 Hook"); });
  mocks.model.mockReset().mockImplementation(() => { throw new Error("成果投递不得调用模型"); });
  mocks.tool.mockReset().mockImplementation(() => { throw new Error("成果投递不得调用业务工具"); });
});
afterEach(async () => {
  try {
    if (!isolatedDbAccepted || runIds.length === 0) return;
    expect(mocks.model).not.toHaveBeenCalled();
    expect(mocks.tool).not.toHaveBeenCalled();
    expect(mocks.createHook).not.toHaveBeenCalled();
    expect(await db.select({ id: modelCalls.id }).from(modelCalls).where(and(
      eq(modelCalls.workspaceId, mocks.workspaceId), inArray(modelCalls.runId, runIds),
    ))).toHaveLength(0);
    expect(await db.select({ id: toolOperations.id }).from(toolOperations).where(and(
      eq(toolOperations.workspaceId, mocks.workspaceId), inArray(toolOperations.sourceRunId, runIds),
    ))).toHaveLength(0);
  } finally {
    if (isolatedDbAccepted && runIds.length > 0) {
      await db.delete(defaultResultDeliveries).where(and(eq(defaultResultDeliveries.workspaceId, mocks.workspaceId), inArray(defaultResultDeliveries.runId, runIds)));
      await db.delete(modelCalls).where(and(eq(modelCalls.workspaceId, mocks.workspaceId), inArray(modelCalls.runId, runIds)));
      await db.delete(toolOperations).where(and(eq(toolOperations.workspaceId, mocks.workspaceId), inArray(toolOperations.sourceRunId, runIds)));
      await db.delete(runs).where(and(eq(runs.workspaceId, mocks.workspaceId), inArray(runs.id, runIds)));
    }
    runIds.length = 0;
    sdkRunIds.clear();
    streams.clear();
    vi.restoreAllMocks();
  }
});

type RunOverrides = Partial<Pick<typeof runs.$inferInsert,
  "status" | "workflowRunId" | "defaultResultTrackingVersion" | "sourceType" | "sourceKey" | "parentRunId" | "result" | "context" | "finishedAt" | "error"
>>;
async function fixture(overrides: RunOverrides = {}) {
  const id = randomUUID();
  runIds.push(id);
  const [run] = await db.insert(runs).values({
    id, workspaceId: mocks.workspaceId, createdBy: mocks.createdBy, agentId: randomUUID(), versionId: randomUUID(),
    workflowRunId: `wrun_${randomUUID()}`, defaultResultTrackingVersion: DEFAULT_RESULT_TRACKING_VERSION,
    sourceType: "manual", parentRunId: null, status: "running", startedAt: new Date(),
    input: { inputOnly: "不进入成果流" }, context: { outputs: { retained: "完成前内容" } }, ...overrides,
  }).returning();
  sdkRunIds.set(run.id, run.workflowRunId);
  mocks.metadata.mockReturnValue({ workflowRunId: run.workflowRunId ?? "wrun_missing" });
  return run;
}
function complete(runId: string, result: Record<string, unknown> = { receiptId: "receipt-1", amount: 0, approved: false }) {
  return completeRunResult({
    runId, result, contextOutputs: { source: result, contextOnly: "只留在运行上下文" }, outcome: "completed",
    expectedSdkRunId: sdkRunIds.get(runId) ?? undefined,
  });
}
async function savedRun(runId: string) {
  const [run] = await db.select().from(runs).where(and(eq(runs.id, runId), eq(runs.workspaceId, mocks.workspaceId)));
  if (!run) throw new Error("本套件创建的运行不存在");
  return run;
}
function deliveries(runId: string) {
  return db.select().from(defaultResultDeliveries).where(and(eq(defaultResultDeliveries.runId, runId), eq(defaultResultDeliveries.workspaceId, mocks.workspaceId)));
}
async function savedDelivery(runId: string) {
  const rows = await deliveries(runId);
  expect(rows).toHaveLength(1);
  return rows[0];
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((release) => { resolve = release; });
  return { promise, resolve };
}
function holdNextTransaction() {
  const held = deferred(), released = deferred();
  const transaction = db.transaction.bind(db);
  // Delegate every query to Postgres and hold its row lock only at the real transaction's commit boundary.
  const spy = vi.spyOn(db, "transaction").mockImplementationOnce((async (callback: Parameters<typeof db.transaction>[0]) =>
    transaction(async (tx) => {
      const result = await callback(tx);
      held.resolve();
      await released.promise;
      return result;
    })) as typeof db.transaction);
  return { held: held.promise, release: released.resolve, restore: () => spy.mockRestore() };
}

describe("成果投递真实数据库事务与竞争（模拟 SDK 接口，非实际 SDK 验收；仅 CI 隔离库）", () => {
  it.each(["manual", "schedule", "evaluation"] as const)("新版 %s 根运行在同一事务保存完成终态和冻结成果", async (sourceType) => {
    const run = await fixture({ sourceType });
    const result = { receiptId: "receipt-1", amount: 0, approved: false };
    const completed = await complete(run.id, result);
    expect(completed).toEqual({ outcome: { kind: "completed", runId: run.id, deliveryRequired: true }, result, newlyCompleted: true });
    const saved = await savedRun(run.id), delivery = await savedDelivery(run.id);
    expect(saved).toMatchObject({ status: "completed", result, context: { outputs: { source: result, contextOnly: "只留在运行上下文" } } });
    expect(saved.finishedAt).toBeInstanceOf(Date);
    expect(delivery).toMatchObject({
      workspaceId: mocks.workspaceId, createdBy: mocks.createdBy, runId: run.id, sdkRunId: run.workflowRunId,
      status: "ready", writeAttempts: 0, operation: null, operationToken: null, producerSettled: true, acknowledgement: "none", confirmedAt: null,
      frozen: { frame: { runId: run.id, frameId: run.id, status: "completed", outcome: "completed", result, finishedAt: saved.finishedAt!.toISOString() } },
    });
    expect(delivery.frozen).toEqual(freezeDefaultResultFrame({
      runId: run.id, status: "completed", outcome: "completed", result, finishedAt: saved.finishedAt!.toISOString(),
    }));
    expect(JSON.stringify(delivery.frozen)).not.toMatch(/inputOnly|contextOnly|不进入成果流|只留在运行上下文/);
    expect(mocks.observe).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("真实投递唯一键冲突回滚完成终态、成果和上下文", async () => {
    const run = await fixture();
    const frozen = freezeDefaultResultFrame({ runId: run.id, status: "completed", outcome: "completed", finishedAt: "2026-10-01T00:00:00.000Z", result: { receiptId: "先存快照" } });
    await db.insert(defaultResultDeliveries).values({ id: randomUUID(), workspaceId: mocks.workspaceId, createdBy: mocks.createdBy, runId: run.id, sdkRunId: run.workflowRunId!, frozen });
    const originalDelivery = await savedDelivery(run.id);
    await expect(complete(run.id)).rejects.toThrow("运行成果暂时无法原子保存");
    expect(await savedRun(run.id)).toEqual(run);
    expect(await savedDelivery(run.id)).toEqual(originalDelivery);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("并发完成只冻结一帧；结果、完成时间和 hash 不被重入的新输入覆盖", async () => {
    const run = await fixture();
    const inputs = [0, 1, 2, 3].map((index) => ({ receiptId: `receipt-${index}`, amount: index, approved: false }));
    const outcomes = await Promise.all(inputs.map((result) => complete(run.id, result)));
    expect(outcomes.filter((outcome) => outcome.newlyCompleted)).toHaveLength(1);
    const saved = await savedRun(run.id), delivery = await savedDelivery(run.id);
    expect(inputs).toContainEqual(saved.result);
    expect(outcomes.map((outcome) => outcome.result)).toEqual(inputs.map(() => saved.result));
    expect(outcomes.every((outcome) => outcome.outcome.kind === "completed" && outcome.outcome.deliveryRequired)).toBe(true);
    expect(delivery.frozen.frame.result).toEqual(saved.result);
    expect(delivery.frozen.frame.finishedAt).toBe(saved.finishedAt!.toISOString());
    expect(classifyDefaultResultFrame(delivery.frozen, delivery.frozen.frame)).toBe("match");
    const repeated = await completeRunResult({ runId: run.id, result: { changed: true }, contextOutputs: { changed: "新上下文" }, outcome: "not_approved", expectedSdkRunId: run.workflowRunId! });
    expect(repeated).toMatchObject({ result: saved.result, newlyCompleted: false });
    expect(await savedRun(run.id)).toEqual(saved);
    expect(await savedDelivery(run.id)).toEqual(delivery);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it.each(["failed", "cancelled"] as const)("%s 后迟到完成不假报成功，也不生成成果投递", async (status) => {
    const run = await fixture({ status, error: "原终态原因", finishedAt: new Date("2026-10-01T01:00:00.000Z") });
    expect(await complete(run.id)).toEqual({ outcome: { kind: "stopped", runId: run.id, status }, result: null, newlyCompleted: false });
    expect(await finalizeRun(run.id, { lateResult: "迟到业务成果" })).toEqual({ kind: "stopped", runId: run.id, status });
    expect(await savedRun(run.id)).toEqual(run);
    expect(await deliveries(run.id)).toHaveLength(0);
    expect(mocks.appendTrace).not.toHaveBeenCalled();
    await expect(deliverDefaultResult(run.id, mocks.workspaceId)).rejects.toThrow("本次运行没有可发送的主流程成果");
    expect(mocks.observe).not.toHaveBeenCalled();
  });

  it("取消事务先持锁时，竞争完成只能看见取消终态，不能产生 outbox", async () => {
    const run = await fixture();
    const hold = holdNextTransaction();
    const cancelling = cancelRunAction(run.id);
    let completing: ReturnType<typeof complete> | undefined;
    try {
      await Promise.race([hold.held, cancelling.then(() => { throw new Error("取消没有进入持锁事务"); })]);
      completing = complete(run.id);
      hold.release();
      expect(await cancelling).toEqual({ ok: true });
      expect(await completing).toEqual({ outcome: { kind: "stopped", runId: run.id, status: "cancelled" }, result: null, newlyCompleted: false });
      const cancelled = await savedRun(run.id);
      expect(cancelled).toMatchObject({ status: "cancelled", result: null, context: run.context, error: "已由员工取消" });
      expect(await deliveries(run.id)).toHaveLength(0);
      expect(await finalizeRun(run.id, { lateResult: "迟到成果" })).toEqual({ kind: "stopped", runId: run.id, status: "cancelled" });
      expect(await savedRun(run.id)).toEqual(cancelled);
      expect(mocks.appendTrace.mock.calls.some(([event]) => event.kind === "run.completed")).toBe(false);
      expect(mocks.write).not.toHaveBeenCalled();
    } finally {
      hold.release();
      await Promise.allSettled([cancelling, ...(completing ? [completing] : [])]);
      hold.restore();
    }
  });

  it("完成事务先持锁时，竞争取消不能覆盖已冻结的完成成果", async () => {
    const run = await fixture();
    const hold = holdNextTransaction();
    const completing = complete(run.id);
    let cancelling: ReturnType<typeof cancelRunAction> | undefined;
    try {
      await Promise.race([hold.held, completing.then(() => { throw new Error("完成没有进入持锁事务"); })]);
      cancelling = cancelRunAction(run.id);
      hold.release();
      expect(await completing).toMatchObject({ outcome: { kind: "completed", deliveryRequired: true }, newlyCompleted: true });
      expect(await cancelling).toMatchObject({ ok: false });
      const saved = await savedRun(run.id), delivery = await savedDelivery(run.id);
      expect(saved.status).toBe("completed");
      expect(delivery.frozen.frame.result).toEqual(saved.result);
      expect(delivery.frozen.frame.finishedAt).toBe(saved.finishedAt!.toISOString());
      expect(mocks.cancel).not.toHaveBeenCalled();
      expect(mocks.write).not.toHaveBeenCalled();
    } finally {
      hold.release();
      await Promise.allSettled([completing, ...(cancelling ? [cancelling] : [])]);
      hold.restore();
    }
  });

  it.each(["manual", "schedule", "evaluation"] as const)("%s 即使声明新版标记，原始父标识非空也不生成主流程投递", async (sourceType) => {
    const run = await fixture({ sourceType, parentRunId: randomUUID() });
    expect(await complete(run.id)).toMatchObject({ outcome: { kind: "completed", deliveryRequired: false }, newlyCompleted: true });
    expect((await savedRun(run.id)).status).toBe("completed");
    expect(await deliveries(run.id)).toHaveLength(0);
    expect(await readDefaultResultDelivery(run.id, mocks.workspaceId)).toBeNull();
  });

  it.each(["agent_call", "handoff"] as const)("%s 缺少父标识及 SDK 绑定也不能冒充根流程投递", async (sourceType) => {
    const run = await fixture({ sourceType, parentRunId: null, sourceKey: null, workflowRunId: null });
    expect(await complete(run.id)).toMatchObject({ outcome: { kind: "completed", deliveryRequired: false }, newlyCompleted: true });
    expect(await deliveries(run.id)).toHaveLength(0);
    expect(await readDefaultResultDelivery(run.id, mocks.workspaceId)).toBeNull();
  });

  it.each(["manual", "schedule", "evaluation"] as const)("历史 %s 标记为 NULL 时不补生成投递", async (sourceType) => {
    const run = await fixture({ sourceType, defaultResultTrackingVersion: null });
    expect(await complete(run.id)).toMatchObject({ outcome: { kind: "completed", deliveryRequired: false } });
    expect(await deliveries(run.id)).toHaveLength(0);
    expect(await readDefaultResultDelivery(run.id, mocks.workspaceId)).toBeNull();
  });

  it("历史已完成记录在重入时保持原成果及时间，不推测补生成新版投递", async () => {
    const run = await fixture({ status: "completed", defaultResultTrackingVersion: null, workflowRunId: null, result: { original: true }, finishedAt: new Date("2026-10-01T00:00:00.000Z") });
    expect(await complete(run.id, { changed: true })).toEqual({ outcome: { kind: "completed", runId: run.id, deliveryRequired: false }, result: run.result, newlyCompleted: false });
    expect(await savedRun(run.id)).toEqual(run);
    expect(await deliveries(run.id)).toHaveLength(0);
  });

  it.each(["manual", "schedule", "evaluation"] as const)("新版 %s 根运行缺 SDK 绑定时整体回滚", async (sourceType) => {
    const run = await fixture({ sourceType, workflowRunId: null });
    await expect(complete(run.id)).rejects.toThrow("运行的成果执行身份无法确认");
    expect(await savedRun(run.id)).toEqual(run);
    expect(await deliveries(run.id)).toHaveLength(0);
    expect(mocks.observe).not.toHaveBeenCalled();
  });

  it.each(["missing", "different"] as const)("当前 SDK 身份 %s 时拒绝首次完成及已冻结成果重入", async (mode) => {
    const run = await fixture();
    const expectedSdkRunId = mode === "missing" ? undefined : `wrun_${randomUUID()}`;
    const invalidCompletion = () => completeRunResult({ runId: run.id, result: { changed: true }, contextOutputs: { changed: true }, outcome: "completed", expectedSdkRunId });
    await expect(invalidCompletion()).rejects.toThrow("当前流程不属于运行的执行身份");
    expect(await savedRun(run.id)).toEqual(run);
    expect(await deliveries(run.id)).toHaveLength(0);
    await complete(run.id);
    const originalRun = await savedRun(run.id), originalDelivery = await savedDelivery(run.id);
    await expect(invalidCompletion()).rejects.toThrow("当前流程不属于运行的执行身份");
    expect(await savedRun(run.id)).toEqual(originalRun);
    expect(await savedDelivery(run.id)).toEqual(originalDelivery);
    expect(mocks.observe).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("其他版本标记不能自动声明 SDK5 主流程成果投递", async () => {
    const run = await fixture({ defaultResultTrackingVersion: "sdk5-v0" });
    expect(await complete(run.id)).toMatchObject({ outcome: { kind: "completed", deliveryRequired: false } });
    expect(await deliveries(run.id)).toHaveLength(0);
    expect(await readDefaultResultDelivery(run.id, mocks.workspaceId)).toBeNull();
  });

  it("两个 sender 竞争只领取一次 write，完整读回再 close 确认且不改业务运行", async () => {
    const run = await fixture();
    await complete(run.id);
    const originalRun = await savedRun(run.id), originalDelivery = await savedDelivery(run.id);
    const entered = deferred(), released = deferred();
    const performWrite = mocks.write.getMockImplementation()!;
    const performClose = mocks.close.getMockImplementation()!;
    let writeToken: string | null = null;
    mocks.write.mockImplementationOnce(async (input) => {
      const claimed = await savedDelivery(run.id);
      expect(claimed).toMatchObject({ status: "sending", operation: "write", writeAttempts: 1, producerSettled: false, acknowledgement: "unknown" });
      expect(claimed.operationToken).toBeTruthy();
      expect(input.frozen).toEqual(originalDelivery.frozen);
      expect(input.owner).toEqual({ workspaceId: mocks.workspaceId, runId: run.id, sdkRunId: run.workflowRunId, root: true, frameHash: originalDelivery.frozen.frameHash });
      writeToken = claimed.operationToken;
      entered.resolve();
      await released.promise;
      return performWrite(input);
    });
    mocks.close.mockImplementationOnce(async (input) => {
      const claimed = await savedDelivery(run.id);
      expect(claimed).toMatchObject({ status: "sending", operation: "close", writeAttempts: 1, producerSettled: false, acknowledgement: "unknown" });
      expect(claimed.operationToken).toBeTruthy();
      expect(claimed.operationToken).not.toBe(writeToken);
      expect(input.frozen).toEqual(originalDelivery.frozen);
      return performClose(input);
    });
    const first = deliverDefaultResult(run.id, mocks.workspaceId);
    try {
      await Promise.race([entered.promise, first.then(() => { throw new Error("sender 未进入 write"); })]);
      expect(await deliverDefaultResult(run.id, mocks.workspaceId)).toMatchObject({ status: "sending" });
      expect(mocks.write).toHaveBeenCalledTimes(1);
      expect(mocks.close).not.toHaveBeenCalled();
      released.resolve();
      expect(await first).toMatchObject({ status: "confirmed" });
    } finally {
      released.resolve();
      await Promise.allSettled([first]);
    }
    const confirmed = await savedDelivery(run.id);
    expect(confirmed).toMatchObject({ status: "confirmed", acknowledgement: "confirmed", producerSettled: true, writeAttempts: 1, frozen: originalDelivery.frozen });
    expect(confirmed.confirmedAt).toBeInstanceOf(Date);
    expect(stream(run.id)).toEqual({ done: true, frames: [originalDelivery.frozen.frame] });
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.close).toHaveBeenCalledTimes(1);
    const observed = mocks.observe.mock.calls.length;
    expect(await deliverDefaultResult(run.id, mocks.workspaceId)).toMatchObject({ status: "confirmed" });
    expect(mocks.observe).toHaveBeenCalledTimes(observed);
    expect(await savedRun(run.id)).toEqual(originalRun);
    expect(await savedDelivery(run.id)).toEqual(confirmed);
  });

  it.each(["write", "close"] as const)("%s 发送中的旁路读取故障保留原凭据，原发送者仍能确认", async (operation) => {
    const run = await fixture();
    await complete(run.id);
    const originalRun = await savedRun(run.id), originalDelivery = await savedDelivery(run.id);
    if (operation === "close") stream(run.id).frames.push(structuredClone(originalDelivery.frozen.frame));
    const entered = deferred(), released = deferred();
    const target = operation === "write" ? mocks.write : mocks.close;
    const perform = target.getMockImplementation()!;
    target.mockImplementationOnce(async (input) => {
      const claimed = await savedDelivery(run.id);
      expect(claimed).toMatchObject({
        status: "sending", operation, writeAttempts: Number(operation === "write"),
        acknowledgement: "unknown", producerSettled: false, confirmedAt: null,
      });
      expect(claimed.operationToken).toBeTruthy();
      expect(input.frozen).toEqual(originalDelivery.frozen);
      const acknowledged = await perform(input);
      entered.resolve();
      await released.promise;
      return acknowledged;
    });
    const first = deliverDefaultResult(run.id, mocks.workspaceId);
    let companion: ReturnType<typeof deliverDefaultResult> | undefined;
    try {
      await Promise.race([entered.promise, first.then(() => { throw new Error("原发送者未暂停在当前操作回执"); })]);
      const sending = await savedDelivery(run.id);
      expect(sending).toMatchObject({ status: "sending", operation, acknowledgement: "unknown", producerSettled: false });
      const observed = mocks.observe.mock.calls.length;
      mocks.observe.mockImplementationOnce(async (input) => {
        expect(input.producerSettled).toBe(false);
        expect(input.owner.sdkRunId).toBe(run.workflowRunId);
        expect(input.frozen).toEqual(originalDelivery.frozen);
        throw new mocks.DefaultResultStreamSdkError("observation-failed", "test-only-active-sender-observation-outage", "none");
      });
      companion = deliverDefaultResult(run.id, mocks.workspaceId, true);
      expect(await companion).toMatchObject({ status: "sending" });
      expect(mocks.observe).toHaveBeenCalledTimes(observed + 1);
      const pending = await savedDelivery(run.id);
      expect(pending).toMatchObject({
        status: "sending", operation, operationToken: sending.operationToken, writeAttempts: sending.writeAttempts,
        acknowledgement: "unknown", producerSettled: false, confirmedAt: null,
        error: "成果流暂时无法完整核对，原流程等待恢复消息",
      });
      expect(pending.error).not.toContain("test-only-active-sender-observation-outage");
      expect({ ...pending, error: sending.error, updatedAt: sending.updatedAt }).toEqual(sending);
      expect(mocks.write).toHaveBeenCalledTimes(Number(operation === "write"));
      expect(mocks.close).toHaveBeenCalledTimes(Number(operation === "close"));
      expect(await savedRun(run.id)).toEqual(originalRun);
      released.resolve();
      expect(await first).toMatchObject({ status: "confirmed" });
    } finally {
      released.resolve();
      await Promise.allSettled([first, ...(companion ? [companion] : [])]);
    }
    const confirmed = await savedDelivery(run.id);
    expect(confirmed).toMatchObject({
      status: "confirmed", operation: "close", writeAttempts: Number(operation === "write"),
      acknowledgement: "confirmed", producerSettled: true, error: null,
      sdkRunId: run.workflowRunId, frozen: originalDelivery.frozen,
    });
    expect(confirmed.confirmedAt).toBeInstanceOf(Date);
    expect(confirmed.frozen.frame.finishedAt).toBe(originalRun.finishedAt!.toISOString());
    expect(stream(run.id)).toEqual({ done: true, frames: [originalDelivery.frozen.frame] });
    expect(mocks.write).toHaveBeenCalledTimes(Number(operation === "write"));
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(await savedRun(run.id)).toEqual(originalRun);
    expect(mocks.model).not.toHaveBeenCalled();
    expect(mocks.tool).not.toHaveBeenCalled();
  });

  it("发送有 ACK 但未完整读回时先待核对，后续只 close 原冻结成果", async () => {
    const run = await fixture();
    await complete(run.id);
    const originalRun = await savedRun(run.id), originalDelivery = await savedDelivery(run.id);
    mocks.write.mockImplementationOnce(async (input) => {
      stream(run.id).frames.push(structuredClone(input.frozen.frame));
      return observation(input, { readStatus: "unavailable" });
    });
    expect(await deliverDefaultResult(run.id, mocks.workspaceId)).toMatchObject({ status: "waiting_review" });
    expect(await savedDelivery(run.id)).toMatchObject({ status: "waiting_review", acknowledgement: "confirmed", producerSettled: true, writeAttempts: 1, confirmedAt: null });
    expect(mocks.close).not.toHaveBeenCalled();
    expect(await deliverDefaultResult(run.id, mocks.workspaceId)).toMatchObject({ status: "confirmed" });
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect((await savedDelivery(run.id)).frozen).toEqual(originalDelivery.frozen);
    expect(await savedRun(run.id)).toEqual(originalRun);
  });

  it.each(["write", "close"] as const)("%s ACK 未知时即使记录很旧也不自动重发或关闭", async (operation) => {
    const run = await fixture();
    await complete(run.id);
    const originalRun = await savedRun(run.id), originalDelivery = await savedDelivery(run.id);
    if (operation === "close") stream(run.id).frames.push(structuredClone(originalDelivery.frozen.frame));
    const target = operation === "write" ? mocks.write : mocks.close;
    target.mockImplementationOnce(async (input) => {
      if (operation === "write") stream(run.id).frames.push(structuredClone(input.frozen.frame));
      else stream(run.id).done = true;
      throw new mocks.DefaultResultStreamSdkError("acknowledgement-unknown", "模拟发送回执丢失", "unknown");
    });
    expect(await deliverDefaultResult(run.id, mocks.workspaceId)).toMatchObject({ status: "waiting_review" });
    const old = new Date("2000-01-01T00:00:00.000Z");
    await db.update(defaultResultDeliveries).set({ createdAt: old, updatedAt: old }).where(and(eq(defaultResultDeliveries.runId, run.id), eq(defaultResultDeliveries.workspaceId, mocks.workspaceId)));
    const waiting = await savedDelivery(run.id);
    expect(waiting).toMatchObject({ status: "waiting_review", operation, acknowledgement: "unknown", producerSettled: false, writeAttempts: Number(operation === "write"), confirmedAt: null, frozen: originalDelivery.frozen });
    expect(waiting.operationToken).toBeTruthy();
    const outcomes = await Promise.all([deliverDefaultResult(run.id, mocks.workspaceId), deliverDefaultResult(run.id, mocks.workspaceId, true)]);
    expect(outcomes.every((outcome) => outcome.status === "waiting_review")).toBe(true);
    expect(mocks.write).toHaveBeenCalledTimes(Number(operation === "write"));
    expect(mocks.close).toHaveBeenCalledTimes(Number(operation === "close"));
    expect(await savedDelivery(run.id)).toEqual(waiting);
    expect(await savedRun(run.id)).toEqual(originalRun);
  });

  it.each([0, 1])("旧 sending 记录含 %s 帧也不因时间重领凭据", async (frameCount) => {
    const run = await fixture();
    await complete(run.id);
    const originalRun = await savedRun(run.id), originalDelivery = await savedDelivery(run.id);
    if (frameCount) stream(run.id).frames.push(structuredClone(originalDelivery.frozen.frame));
    await db.update(defaultResultDeliveries).set({
      status: "sending", operation: "write", operationToken: randomUUID(), acknowledgement: "unknown", producerSettled: false,
      writeAttempts: 1, createdAt: new Date("2000-01-01T00:00:00.000Z"), updatedAt: new Date("2000-01-01T00:00:00.000Z"),
    }).where(and(eq(defaultResultDeliveries.runId, run.id), eq(defaultResultDeliveries.workspaceId, mocks.workspaceId)));
    const sending = await savedDelivery(run.id);
    const outcomes = await Promise.all([deliverDefaultResult(run.id, mocks.workspaceId), deliverDefaultResult(run.id, mocks.workspaceId)]);
    expect(outcomes.every((outcome) => outcome.status === "sending")).toBe(true);
    expect(mocks.observe).toHaveBeenCalledTimes(2);
    expect(mocks.observe.mock.calls.every(([input]) => input.producerSettled === false)).toBe(true);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(await savedDelivery(run.id)).toEqual(sending);
    expect(await savedRun(run.id)).toEqual(originalRun);
  });

  it("其他工作区不能读取、领取或发送本运行成果", async () => {
    const run = await fixture();
    await complete(run.id);
    const originalRun = await savedRun(run.id), originalDelivery = await savedDelivery(run.id);
    const otherWorkspace = randomUUID();
    expect(await readDefaultResultDelivery(run.id, otherWorkspace)).toBeNull();
    await expect(deliverDefaultResult(run.id, otherWorkspace)).rejects.toThrow("本次运行没有可发送的主流程成果");
    expect(mocks.observe).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(await savedRun(run.id)).toEqual(originalRun);
    expect(await savedDelivery(run.id)).toEqual(originalDelivery);
  });

  it("同一等待步骤并发重试复用已保存 token，冻结帧及成果不变", async () => {
    const run = await fixture();
    await complete(run.id);
    const originalRun = await savedRun(run.id), originalDelivery = await savedDelivery(run.id);
    expect(originalDelivery).toMatchObject({ waitingHookToken: null, waitingHookStepId: null });
    const stepId = `wstep_${randomUUID()}`;
    const first = await prepareDefaultResultDeliveryWait(run.id, mocks.workspaceId, stepId);
    expect(first).toMatchObject({ status: "ready" });
    expect(first.hookToken).toMatch(new RegExp(`^default-result:${run.id}:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`));
    const prepared = await savedDelivery(run.id);
    expect(prepared).toMatchObject({ waitingHookToken: first.hookToken, waitingHookStepId: stepId, frozen: originalDelivery.frozen });
    const retried = await Promise.all(Array.from({ length: 3 }, () => prepareDefaultResultDeliveryWait(run.id, mocks.workspaceId, stepId)));
    expect(retried).toEqual([first, first, first]);
    expect(await savedDelivery(run.id)).toEqual(prepared);
    expect(await savedRun(run.id)).toEqual(originalRun);
    expect(mocks.observe).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it("下一等待步骤登记新的随机 token，不修改冻结成果或业务运行", async () => {
    const run = await fixture();
    await complete(run.id);
    const originalRun = await savedRun(run.id), originalDelivery = await savedDelivery(run.id);
    const firstStepId = `wstep_${randomUUID()}`, nextStepId = `wstep_${randomUUID()}`;
    const first = await prepareDefaultResultDeliveryWait(run.id, mocks.workspaceId, firstStepId);
    const next = await prepareDefaultResultDeliveryWait(run.id, mocks.workspaceId, nextStepId);
    expect(next.status).toBe("ready");
    expect(next.hookToken).not.toBe(first.hookToken);
    expect(next.hookToken).toMatch(new RegExp(`^default-result:${run.id}:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`));
    const prepared = await savedDelivery(run.id);
    expect(prepared).toMatchObject({ waitingHookToken: next.hookToken, waitingHookStepId: nextStepId, frozen: originalDelivery.frozen, status: "ready", writeAttempts: 0 });
    expect(await prepareDefaultResultDeliveryWait(run.id, mocks.workspaceId, nextStepId)).toEqual(next);
    expect(await savedDelivery(run.id)).toEqual(prepared);
    expect(await savedRun(run.id)).toEqual(originalRun);
    expect(mocks.observe).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
  });

  it.each([false, true])("错误工作区不能读取或改写等待元数据（已有等待入口：%s）", async (hasWait) => {
    const run = await fixture();
    await complete(run.id);
    if (hasWait) await prepareDefaultResultDeliveryWait(run.id, mocks.workspaceId, `wstep_${randomUUID()}`);
    const originalRun = await savedRun(run.id), originalDelivery = await savedDelivery(run.id);
    const select = vi.spyOn(db, "select"), transaction = vi.spyOn(db, "transaction");
    const update = vi.spyOn(db, "update"), insert = vi.spyOn(db, "insert");
    const otherWorkspace = randomUUID();
    await expect(prepareDefaultResultDeliveryWait(run.id, otherWorkspace, `wstep_${randomUUID()}`)).rejects.toThrow("主流程冻结成果不存在");
    // Only the scoped run lookup is allowed; absence prevents the delivery/hook metadata lookup and every write.
    expect(select).toHaveBeenCalledTimes(1);
    expect(transaction).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(mocks.createHook).not.toHaveBeenCalled();
    expect(mocks.observe).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(await savedRun(run.id)).toEqual(originalRun);
    expect(await savedDelivery(run.id)).toEqual(originalDelivery);
    expect(await db.select().from(defaultResultDeliveries).where(and(eq(defaultResultDeliveries.runId, run.id), eq(defaultResultDeliveries.workspaceId, otherWorkspace)))).toHaveLength(0);
  });

  it("已确认终态准备等待时仍返回原 token，不登记新等待步骤", async () => {
    const run = await fixture();
    await complete(run.id);
    const originalRun = await savedRun(run.id);
    const stepId = `wstep_${randomUUID()}`;
    const first = await prepareDefaultResultDeliveryWait(run.id, mocks.workspaceId, stepId);
    expect(await deliverDefaultResult(run.id, mocks.workspaceId)).toMatchObject({ status: "confirmed" });
    const confirmed = await savedDelivery(run.id);
    expect(confirmed).toMatchObject({ status: "confirmed", waitingHookToken: first.hookToken, waitingHookStepId: stepId });
    const transaction = vi.spyOn(db, "transaction"), update = vi.spyOn(db, "update");
    const observed = mocks.observe.mock.calls.length;
    const retried = await Promise.all([
      prepareDefaultResultDeliveryWait(run.id, mocks.workspaceId, stepId),
      prepareDefaultResultDeliveryWait(run.id, mocks.workspaceId, `wstep_${randomUUID()}`),
    ]);
    expect(retried).toEqual([{ status: "confirmed", hookToken: first.hookToken }, { status: "confirmed", hookToken: first.hookToken }]);
    expect(transaction).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(mocks.createHook).not.toHaveBeenCalled();
    expect(mocks.observe).toHaveBeenCalledTimes(observed);
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.close).toHaveBeenCalledTimes(1);
    expect(await savedDelivery(run.id)).toEqual(confirmed);
    expect(await savedRun(run.id)).toEqual(originalRun);
  });
});
