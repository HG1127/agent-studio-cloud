import { describe, expect, it } from "vitest";
import { RUN_DELIVERY_INTENT_KEY } from "@/contracts/run-delivery";
import { deliveryAttemptIssue, deliveryEnvelopeMatches, deliveryRetryDelay, runDeliveryIntentMatches } from "@/server/domain/runtime/run-delivery";
import { RunDeliveryEnvelope } from "@/contracts/run-delivery";
import { presentRunTaskResult } from "@/server/domain/runtime/run-task";

describe("投递防重与有效期", () => {
  const binding = { targetId: "crm.result", targetHash: "a".repeat(64), retentionMs: 300_000 };
  it("旧请求兼容，但不能添加、删去或改换成果接收方", () => {
    expect(runDeliveryIntentMatches({})).toBe(true);
    expect(runDeliveryIntentMatches({}, binding.targetId)).toBe(false);
    expect(runDeliveryIntentMatches({ [RUN_DELIVERY_INTENT_KEY]: binding }, binding.targetId)).toBe(true);
    expect(runDeliveryIntentMatches({ [RUN_DELIVERY_INTENT_KEY]: binding })).toBe(false);
    expect(runDeliveryIntentMatches({ [RUN_DELIVERY_INTENT_KEY]: binding }, "other")).toBe(false);
    expect(runDeliveryIntentMatches({ [RUN_DELIVERY_INTENT_KEY]: { targetId: binding.targetId } }, binding.targetId)).toBe(false);
  });
  it.each([[1, 5000], [2, 10000], [3, 20000], [4, 40000], [5, 60000], [105, 60000]])("第 %i 次失败使用有界退避", (attempt, delay) => {
    expect(deliveryRetryDelay(attempt)).toBe(delay);
  });
  it("有效期边界阻止发送，不延长防重保证", () => {
    const now = new Date("2026-10-08T00:00:00Z");
    expect(deliveryAttemptIssue({ attempts: 0, maxAttempts: 5, retryDeadline: null }, now)).toBeNull();
    expect(deliveryAttemptIssue({ attempts: 1, maxAttempts: 5, retryDeadline: now }, now)).toContain("有效期");
    expect(deliveryAttemptIssue({ attempts: 1, maxAttempts: 5, retryDeadline: new Date(now.getTime() + 1) }, now)).toBeNull();
    expect(deliveryAttemptIssue({ attempts: 5, maxAttempts: 5, retryDeadline: null }, now)).toContain("次数");
  });
  it("冻结快照必须同时属于原任务与原投递", () => {
    const id = "00000000-0000-4000-8000-000000000158";
    const envelope = RunDeliveryEnvelope.parse({ schemaVersion: 1, deliveryId: id, task: presentRunTaskResult({ runId: id, status: "completed", result: { amount: 0 }, error: null, outputContract: { fields: [] } }) });
    expect(deliveryEnvelopeMatches(envelope, id, id)).toBe(true);
    expect(deliveryEnvelopeMatches(envelope, "other", id)).toBe(false);
    expect(deliveryEnvelopeMatches(envelope, id, "other")).toBe(false);
  });
});
