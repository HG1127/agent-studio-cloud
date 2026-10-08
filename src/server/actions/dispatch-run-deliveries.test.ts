import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("@/server/services/run-delivery", () => ({ dispatchPendingDeliveriesCore: mocks.dispatch }));
import { dispatchRunDeliveriesAction } from "./dispatch-run-deliveries";
beforeEach(() => { vi.stubEnv("CRON_SECRET", "delivery-secret"); mocks.dispatch.mockReset().mockResolvedValue({ materialized: 1, claimed: 1 }); vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("投递调度写入口", () => {
  it.each([null, "Bearer wrong", "delivery-secret"])("直接调用动作也须正确调度凭据 %s", async (authorization) => {
    expect(await dispatchRunDeliveriesAction(authorization)).toMatchObject({ ok: false });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it("只调度服务器工作区，不接受客户端选择", async () => {
    expect(await dispatchRunDeliveriesAction("Bearer delivery-secret")).toEqual({ ok: true, materialized: 1, claimed: 1 });
    expect(mocks.dispatch).toHaveBeenCalledWith();
    vi.stubEnv("CRON_SECRET", "");
    expect(await dispatchRunDeliveriesAction("Bearer delivery-secret")).toMatchObject({ ok: false });
  });
  it("未知存储错误可重试，不返回连接串", async () => {
    mocks.dispatch.mockRejectedValue(new Error("postgres://user:private@host/db"));
    const result = await dispatchRunDeliveriesAction("Bearer delivery-secret");
    expect(result).toMatchObject({ ok: false, retryable: true });
    expect(JSON.stringify(result)).not.toContain("private");
  });
});
