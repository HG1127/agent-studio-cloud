import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  observe: vi.fn(), write: vi.fn(), close: vi.fn(), updates: vi.fn(), transaction: vi.fn(), lockedRead: vi.fn(),
  run: {} as Record<string, unknown>, delivery: {} as Record<string, unknown>,
}));
vi.mock("@/lib/db", () => {
  function select() {
    let table: { [key: string]: unknown };
    const query = {
      from(value: typeof table) { table = value; return query; },
      where() { return query; }, for() { mocks.lockedRead(); return query; },
      async limit() { return [structuredClone("frozen" in table! ? mocks.delivery : mocks.run)]; },
    };
    return query;
  }
  function update() {
    let values: Record<string, unknown>;
    const query = {
      set(value: typeof values) { values = value; return query; },
      where() { return query; },
      async returning() {
        mocks.updates(values);
        mocks.delivery = { ...mocks.delivery, ...values };
        return [structuredClone(mocks.delivery)];
      },
    };
    return query;
  }
  const db = { select, update, transaction: mocks.transaction };
  mocks.transaction.mockImplementation((callback: (tx: typeof db) => unknown) => callback(db));
  return { db };
});
vi.mock("@/server/services/default-result-stream-sdk", () => ({
  observeDefaultResultStream: mocks.observe, writeDefaultResultStreamFrame: mocks.write, closeDefaultResultStream: mocks.close,
  DefaultResultStreamSdkError: class extends Error {
    constructor(readonly code: string, message: string, readonly acknowledgement: "none" | "unknown" | "confirmed" = "none") { super(message); }
  },
}));
import { FatalError } from "workflow";
import type { DefaultResultStreamObservation } from "@/contracts/default-result-stream";
import { freezeDefaultResultFrame } from "@/server/domain/runtime/default-result-stream";
import { DefaultResultStreamSdkError } from "./default-result-stream-sdk";
import { deliverDefaultResult } from "./default-result-delivery";

const runId = randomUUID(), workspaceId = randomUUID(), createdBy = randomUUID(), sdkRunId = "wrun_safe_pending";
const now = new Date("2026-10-12T00:00:00.000Z"), result = { amount: 0, approved: false };
const frozen = freezeDefaultResultFrame({ runId, status: "completed", outcome: "completed", finishedAt: now.toISOString(), result });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.observe.mockReset(); mocks.write.mockReset(); mocks.close.mockReset(); mocks.lockedRead.mockReset();
  mocks.run = { id: runId, workspaceId, createdBy, status: "completed", parentRunId: null,
    sourceType: "manual", workflowRunId: sdkRunId, defaultResultTrackingVersion: "sdk5-v1", finishedAt: now, result };
  mocks.delivery = { runId, workspaceId, createdBy, sdkRunId, frozen, status: "ready", writeAttempts: 0,
    operation: null, operationToken: null, waitingHookToken: null, waitingHookStepId: null,
    acknowledgement: "none", producerSettled: true, error: null, createdAt: now, updatedAt: now, confirmedAt: null };
});
function unreadable() {
  return new DefaultResultStreamSdkError("observation-failed", "password=private-never-return", "none");
}
function emptyObservation(): DefaultResultStreamObservation {
  return { workspaceId, runId, sdkRunId, frameHash: frozen.frameHash, producerSettled: true,
    metadata: { done: false, tailIndex: -1 }, readStatus: "verified_snapshot", matchedFrames: 0, conflictingFrames: 0 };
}
describe("安全成果故障转持久等待，不消耗原根步骤重试", () => {
  it.each(["confirmed", "failed"] as const)("%s 后多次核对或恢复只返回原终态，不再次观察、发送、关闭或改业务成果", async (status) => {
    mocks.delivery = { ...mocks.delivery, status, waitingHookToken: "private-current-hook", waitingHookStepId: "step_one",
      acknowledgement: status === "confirmed" ? "confirmed" : "none", confirmedAt: status === "confirmed" ? now : null };
    const original = structuredClone({ run: mocks.run, delivery: mocks.delivery });
    for (const verifyOnly of [true, false, true]) {
      await expect(deliverDefaultResult(runId, workspaceId, verifyOnly)).resolves.toEqual({ status, hookToken: "private-current-hook" });
    }
    expect({ run: mocks.run, delivery: mocks.delivery }).toEqual(original);
    expect(mocks.observe).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.updates).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("连续四次观察故障保存固定原因和同一冻结成果，无发送或重领", async () => {
    mocks.observe.mockRejectedValue(unreadable());
    const originalRun = structuredClone(mocks.run);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(deliverDefaultResult(runId, workspaceId)).resolves.toMatchObject({ status: "waiting_review" });
    }
    expect(mocks.observe).toHaveBeenCalledTimes(4);
    expect(mocks.updates).toHaveBeenCalledTimes(4);
    expect(mocks.delivery).toMatchObject({ status: "waiting_review", acknowledgement: "none", producerSettled: true,
      operation: null, operationToken: null, writeAttempts: 0, frozen });
    expect(String(mocks.delivery.error)).toContain("等待恢复消息");
    expect(String(mocks.delivery.error)).not.toContain("private-never-return");
    expect(mocks.run).toEqual(originalRun);
    expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.close).not.toHaveBeenCalled();
  });
  it("正在发送时旁路观察故障保留 sending 与原回执资格，不能解锁或关闭", async () => {
    const token = randomUUID();
    mocks.delivery = { ...mocks.delivery, status: "sending", operation: "write", operationToken: token,
      writeAttempts: 1, acknowledgement: "unknown", producerSettled: false };
    mocks.observe.mockRejectedValue(unreadable());
    await expect(deliverDefaultResult(runId, workspaceId)).resolves.toMatchObject({ status: "sending" });
    expect(mocks.delivery).toMatchObject({ status: "sending", operationToken: token, operation: "write",
      writeAttempts: 1, acknowledgement: "unknown", producerSettled: false, frozen });
    expect(String(mocks.delivery.error)).toContain("等待恢复消息");
    expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.close).not.toHaveBeenCalled();
  });
  it("发送前明确没有 ACK 时保存释放结果并等待，不靠 SDK 自动重试", async () => {
    mocks.observe.mockResolvedValue(emptyObservation());
    mocks.write.mockRejectedValue(new DefaultResultStreamSdkError("observation-failed", "发送前状态未知", "none"));
    await expect(deliverDefaultResult(runId, workspaceId)).resolves.toMatchObject({ status: "ready" });
    expect(mocks.write).toHaveBeenCalledOnce(); expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.delivery).toMatchObject({ status: "ready", operation: "write", writeAttempts: 0,
      acknowledgement: "none", producerSettled: true, confirmedAt: null, frozen });
    expect(mocks.delivery.operationToken).toBeTruthy();
    expect(String(mocks.delivery.error)).toContain("发送尚未开始");
  });
  it("非法来源和未识别故障不冒充安全等待", async () => {
    const invalid = new DefaultResultStreamSdkError("invalid-source", "冻结记录非法", "none");
    mocks.observe.mockRejectedValueOnce(invalid);
    await expect(deliverDefaultResult(runId, workspaceId)).rejects.toBe(invalid);
    const unknown = new FatalError("永久错误");
    mocks.observe.mockRejectedValueOnce(unknown);
    await expect(deliverDefaultResult(runId, workspaceId)).rejects.toBe(unknown);
    expect(mocks.updates).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it.each(["sending", "confirmed"] as const)("保存观察故障时并发已变为 %s，不覆盖新操作或终态", async (status) => {
    mocks.observe.mockRejectedValue(unreadable());
    const token = randomUUID();
    mocks.lockedRead.mockImplementationOnce(() => {
      mocks.delivery = { ...mocks.delivery, status, operation: status === "sending" ? "write" : "close",
        operationToken: token, writeAttempts: 1, producerSettled: status === "confirmed",
        acknowledgement: status === "confirmed" ? "confirmed" : "unknown", confirmedAt: status === "confirmed" ? now : null };
    });
    await expect(deliverDefaultResult(runId, workspaceId)).resolves.toMatchObject({ status });
    expect(mocks.updates).not.toHaveBeenCalled();
    expect(mocks.delivery).toMatchObject({ status, operationToken: token, frozen, error: null });
    expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.close).not.toHaveBeenCalled();
  });
});
