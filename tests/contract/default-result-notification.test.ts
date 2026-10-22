import { describe, expect, it } from "vitest";
import { DefaultResultDeliveryView, RecoverDefaultResultResult } from "@/contracts/default-result-delivery";

const delivery = DefaultResultDeliveryView.parse({
  runId: "11111111-1111-4111-8111-111111111111", status: "confirmed", writeAttempts: 1, error: null,
  createdAt: "2026-10-12T00:00:00.000Z", updatedAt: "2026-10-12T00:00:00.000Z", confirmedAt: "2026-10-12T00:00:00.000Z",
  canRetry: false, canVerify: true,
});
const success = { ok: true, delivery, workflowNotified: false };

describe("成果确认与恢复通知的共享回执", () => {
  it("旧成功结构不强加新字段", () => {
    expect(RecoverDefaultResultResult.parse(success)).toEqual(success);
  });
  it.each(["confirmed", "failed"])("成果%s时可明确报告通知待确认", (status) => {
    const pending = { ...success, delivery: { ...delivery, status }, workflowNotificationPending: true };
    expect(RecoverDefaultResultResult.parse(pending)).toEqual(pending);
  });
  it.each([
    { workflowNotified: true },
    { delivery: { ...delivery, canRetry: true } },
    { delivery: { ...delivery, canVerify: false } },
  ])("拒绝矛盾或不可继续核对的待通知状态 %#", (change) => {
    expect(RecoverDefaultResultResult.safeParse({ ...success, workflowNotificationPending: true, ...change }).success).toBe(false);
  });
  it.each(["ready", "sending", "waiting_review"])("成果仍%s不能虚报只剩通知", (status) => {
    expect(RecoverDefaultResultResult.safeParse({ ...success, delivery: { ...delivery, status }, workflowNotificationPending: true }).success).toBe(false);
  });
  it("待通知标记只在确有未确认通知时出现", () => {
    expect(RecoverDefaultResultResult.safeParse({ ...success, workflowNotificationPending: false }).success).toBe(false);
  });
  it("不通过新字段开放内部执行信息", () => {
    expect(RecoverDefaultResultResult.safeParse({ ...success, workflowNotificationPending: true, sdkRunId: "private" }).success).toBe(false);
  });
});
