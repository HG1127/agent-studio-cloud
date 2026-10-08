import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rows: [] as unknown[], write: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/db", () => {
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ for: () => ({ limit: async () => mocks.rows }) }) }) }),
    update: () => ({ set: (value: unknown) => { mocks.write(value); return { where: async () => undefined }; } }),
  };
  return { db: { transaction: async (callback: (client: typeof tx) => unknown) => { mocks.transaction(); return callback(tx); } } };
});
import { retryRunDeliveryAction } from "./retry-run-delivery";
import { RunDeliveryEnvelope } from "@/contracts/run-delivery";
import { presentRunTaskResult } from "@/server/domain/runtime/run-task";
import { deliveryTargetBinding, parseDeliveryTargets } from "@/server/delivery/target-registry";
import { canonicalJson } from "@/server/domain/canonical-json";

const id = "00000000-0000-4000-8000-000000000158";
const requestId = "00000000-0000-4000-8000-000000000159";
const target = { id: "retry.delivery", revision: "1", endpoint: "https://receiver.test/results", idempotent: true, retentionMs: 600_000 };
const binding = deliveryTargetBinding(parseDeliveryTargets(JSON.stringify([target]))[0]);
const payload = RunDeliveryEnvelope.parse({ schemaVersion: 1, deliveryId: id, task: presentRunTaskResult({ runId: id, status: "completed", result: { amount: 0, approved: false }, error: null, outputContract: { fields: [] } }) });
const input = { requestId, confirmed: true as const, reason: "已核对接收方" };
const row = { id, runId: id, ...binding, status: "failed", payload, attempts: 5, maxAttempts: 5, resolutions: [], retryDeadline: new Date(Date.now() + 600_000) };
beforeEach(() => { mocks.rows = [row]; mocks.write.mockReset(); mocks.transaction.mockReset(); vi.stubEnv("RUN_DELIVERY_TARGETS_JSON", JSON.stringify([target])); vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("人工补投完整性与防重", () => {
  it("登记补投只增加有限额度，不发送、不改正文或有效期", async () => {
    expect(await retryRunDeliveryAction(id, input)).toEqual({ ok: true, runId: id, deliveryId: id, recorded: true });
    const change = mocks.write.mock.calls[0][0];
    expect(change).toMatchObject({ status: "pending", maxAttempts: 10 });
    expect(change).not.toHaveProperty("attempts"); expect(change).not.toHaveProperty("payload"); expect(change).not.toHaveProperty("retryDeadline");
    expect(change.resolutions).toHaveLength(1);
  });
  it.each([null, {}, { ...payload, deliveryId: requestId }, { ...payload, task: { ...payload.task, runId: requestId } }])("坏快照或错误归属拒绝补投 %j", async (badPayload) => {
    mocks.rows = [{ ...row, payload: badPayload }];
    expect((await retryRunDeliveryAction(id, input)).ok).toBe(false);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("原请求登记已保存时找回同一回执，不重复增加额度", async () => {
    const requestHash = createHash("sha256").update(canonicalJson(input)).digest("hex");
    mocks.rows = [{ ...row, status: "delivered", resolutions: [{ requestId, requestHash }] }];
    expect((await retryRunDeliveryAction(id, input)).ok).toBe(true);
    expect((await retryRunDeliveryAction(id, { ...input, reason: "改换原因" })).ok).toBe(false);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it.each([{ status: "sending" }, { status: "delivered" }, { retryDeadline: new Date(0) }, { resolutions: Array.from({ length: 20 }, () => ({ requestId: "other" })) }, { targetHash: "a".repeat(64) }])("保护已处理、有效期、次数和接收方边界 %j", async (change) => {
    mocks.rows = [{ ...row, ...change }];
    expect((await retryRunDeliveryAction(id, input)).ok).toBe(false);
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
