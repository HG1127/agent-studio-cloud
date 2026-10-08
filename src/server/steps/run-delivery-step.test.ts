import { beforeEach, describe, expect, it, vi } from "vitest";
import { FatalError, RetryableError } from "workflow";
const mocks = vi.hoisted(() => ({ attempt: vi.fn() }));
vi.mock("@/server/services/run-delivery", () => ({ attemptRunDeliveryCore: mocks.attempt }));
import { attemptRunDelivery } from "./run-delivery-step";

beforeEach(() => { mocks.attempt.mockReset(); });
describe("投递步骤重试边界", () => {
  it.each(["delivered", "stale"])("%s 不改写主任务", async (kind) => {
    mocks.attempt.mockResolvedValue({ kind });
    expect(await attemptRunDelivery("delivery", "workspace", "token")).toBe(kind);
  });
  it("可重试错误交给实际 SDK", async () => {
    mocks.attempt.mockResolvedValue({ kind: "retry", after: 5000, error: "接收方未确认" });
    await expect(attemptRunDelivery("delivery", "workspace", "token")).rejects.toBeInstanceOf(RetryableError);
    expect(attemptRunDelivery.maxRetries).toBe(7);
  });
  it("永久拒绝不吞错，存储错误使用安全重试", async () => {
    mocks.attempt.mockResolvedValueOnce({ kind: "fatal", error: "防重有效期已过" }).mockRejectedValueOnce(new Error("postgres://private"));
    await expect(attemptRunDelivery("delivery", "workspace", "token")).rejects.toBeInstanceOf(FatalError);
    await expect(attemptRunDelivery("delivery", "workspace", "token")).rejects.toThrow("投递状态暂时无法确认");
  });
});
