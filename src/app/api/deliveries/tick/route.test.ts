import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("@/server/actions/dispatch-run-deliveries", () => ({ dispatchRunDeliveriesAction: mocks.dispatch }));
import { GET, POST } from "./route";
beforeEach(() => { vi.stubEnv("CRON_SECRET", "delivery-secret"); mocks.dispatch.mockReset().mockResolvedValue({ ok: true, materialized: 1, claimed: 1 }); });
afterEach(() => vi.unstubAllEnvs());
describe("投递调度保护", () => {
  it("未配置或错误密钥不启动任何投递", async () => {
    expect((await GET(new Request("http://localhost/api/deliveries/tick"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await POST(new Request("http://localhost/api/deliveries/tick", { headers: { authorization: "Bearer delivery-secret" } }))).status).toBe(401);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it.each([GET, POST])("既有密钥授权后处理有界批次", async (handle) => {
    const response = await handle(new Request("http://localhost/api/deliveries/tick", { headers: { authorization: "Bearer delivery-secret" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, materialized: 1, claimed: 1 });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("不确定调度返回重试而非伪报成功", async () => {
    mocks.dispatch.mockResolvedValue({ ok: false, error: "暂时失败", retryable: true });
    const response = await GET(new Request("http://localhost/api/deliveries/tick", { headers: { authorization: "Bearer delivery-secret" } }));
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("60");
  });
});
