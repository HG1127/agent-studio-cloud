import { describe, expect, it } from "vitest";
import { DEFAULT_RESULT_TRACKING_VERSION, type DefaultResultCompletionSource, type DefaultResultDeliveryRecord } from "@/contracts/default-result-delivery";
import { freezeDefaultResultFrame } from "./default-result-stream";
import { canClaimDefaultResultOperation, defaultResultDeliveryHookToken, defaultResultDeliveryOwner, defaultResultDeliveryView, requiresDefaultResultDelivery, settledDefaultResultOperation } from "./default-result-delivery";

const runId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const createdBy = "33333333-3333-4333-8333-333333333333";
const source: DefaultResultCompletionSource = { runId, workspaceId, createdBy, parentRunId: null, sourceType: "manual", sdkRunId: "wrun_test", trackingVersion: DEFAULT_RESULT_TRACKING_VERSION };
const now = "2026-10-12T00:00:00.000Z";
const record: DefaultResultDeliveryRecord = {
  runId, workspaceId, createdBy, sdkRunId: "wrun_test",
  frozen: freezeDefaultResultFrame({ runId, status: "completed", outcome: "completed", finishedAt: now, result: { answer: "完成" } }),
  status: "ready", writeAttempts: 0, operation: null, operationToken: null, waitingHookToken: null, waitingHookStepId: null,
  acknowledgement: "none", producerSettled: true, error: null, createdAt: now, updatedAt: now, confirmedAt: null,
};

describe("成果投递持久状态", () => {
  it.each(["manual", "schedule", "evaluation"] as const)("只为新版本 %s 主流程冻结", (sourceType) => {
    expect(requiresDefaultResultDelivery({ ...source, sourceType })).toBe(true);
  });
  it.each(["agent_call", "handoff"] as const)("旧 %s 缺少父标识也不是主流程", (sourceType) => {
    expect(requiresDefaultResultDelivery({ ...source, sourceType })).toBe(false);
  });
  it("子流程、历史运行不自动冒充 SDK5 成果投递", () => {
    expect(requiresDefaultResultDelivery({ ...source, parentRunId: createdBy })).toBe(false);
    expect(requiresDefaultResultDelivery({ ...source, trackingVersion: null })).toBe(false);
    expect(() => requiresDefaultResultDelivery({ ...source, sdkRunId: null })).toThrow();
  });
  it("核对冻结帧所属运行与 hash，不能换帧或换任务", () => {
    expect(defaultResultDeliveryOwner(record).root).toBe(true);
    expect(() => defaultResultDeliveryOwner({ ...record, runId: createdBy })).toThrow();
    expect(() => defaultResultDeliveryOwner({ ...record, frozen: { ...record.frozen, frameHash: "a".repeat(64) } })).toThrow();
    expect(defaultResultDeliveryHookToken(record)).toContain(record.frozen.frameHash);
  });
  it.each(["sending", "confirmed", "failed"] as const)("%s 不允许新增发送，即便超过租约或持有旧 token", (status) => {
    const state = {
      ...record, status, operationToken: "old", operation: "write" as const, writeAttempts: 1,
      producerSettled: status !== "sending",
      acknowledgement: status === "sending" ? "unknown" as const : status === "confirmed" ? "confirmed" as const : "none" as const,
      confirmedAt: status === "confirmed" ? now : null,
    };
    expect(canClaimDefaultResultOperation(state, "write")).toBe(false);
  });
  it("未知回执不代表 producer 已停止，禁止补写和 close", () => {
    const sending = { ...record, status: "sending" as const, producerSettled: false, acknowledgement: "unknown" as const, writeAttempts: 1, operation: "write" as const, operationToken: "step_one" };
    const settled = settledDefaultResultOperation({ record: sending, operation: "write", acknowledgement: "unknown", confirmed: false, error: "需核对" });
    expect(settled).toMatchObject({ status: "waiting_review", producerSettled: false, writeAttempts: 1 });
    const unknown = { ...sending, ...settled };
    expect(canClaimDefaultResultOperation(unknown, "write")).toBe(false);
    expect(canClaimDefaultResultOperation(unknown, "close")).toBe(false);
    expect(defaultResultDeliveryView(unknown)).toMatchObject({ canRetry: false, canVerify: true });
  });
  it("未触及 wire 的失败可释放独占凭据且不消耗发送次数", () => {
    const sending = { ...record, status: "sending" as const, producerSettled: false, acknowledgement: "unknown" as const, writeAttempts: 1, operation: "write" as const, operationToken: "step_one" };
    expect(settledDefaultResultOperation({ record: sending, operation: "write", acknowledgement: "none", confirmed: false, error: "暂时不可读取" }))
      .toMatchObject({ status: "ready", producerSettled: true, writeAttempts: 0 });
  });
  it("own ops已确认但读回失败仅待核对，不虚报送达", () => {
    const sending = { ...record, status: "sending" as const, producerSettled: false, acknowledgement: "unknown" as const, writeAttempts: 1, operation: "write" as const, operationToken: "step_one" };
    expect(settledDefaultResultOperation({ record: sending, operation: "write", acknowledgement: "confirmed", confirmed: false, error: "读回未确认" }))
      .toMatchObject({ status: "waiting_review", producerSettled: true });
    expect(() => settledDefaultResultOperation({ record: sending, operation: "write", acknowledgement: "unknown", confirmed: true, error: null })).toThrow();
  });
  it("达到自动发送上限仍可核对并只 close，不可 append", () => {
    const exhausted = { ...record, writeAttempts: 5 };
    expect(canClaimDefaultResultOperation(exhausted, "write")).toBe(false);
    expect(canClaimDefaultResultOperation(exhausted, "close")).toBe(true);
    expect(defaultResultDeliveryView(exhausted)).toMatchObject({ canRetry: true, canVerify: true });
  });
});
