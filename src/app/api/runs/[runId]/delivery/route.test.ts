import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), retry: vi.fn() }));
vi.mock("@/server/queries/run-deliveries", () => ({ getRunDelivery: mocks.get }));
vi.mock("@/server/actions/retry-run-delivery", () => ({ retryRunDeliveryAction: mocks.retry }));
import { GET, POST } from "./route";

const id = "00000000-0000-4000-8000-000000000158";
const context = { params: Promise.resolve({ runId: id }) };
const url = `http://localhost/api/runs/${id}/delivery`;
const input = { requestId: id, confirmed: true, reason: "已核对接收方" };
function request(body: unknown = input, headers: Record<string, string> = {}) { return new Request(url, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", ...headers }, body: JSON.stringify(body) }); }
beforeEach(() => { mocks.get.mockReset().mockResolvedValue({ ok: true, runId: id, delivery: null }); mocks.retry.mockReset().mockResolvedValue({ ok: true, runId: id, deliveryId: id, recorded: true }); vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => vi.restoreAllMocks());
describe("任务投递查询与补投入口", () => {
  it("未选接收方与不存在任务有不同语义，且禁止缓存", async () => {
    const response = await GET(new Request(url), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, runId: id, delivery: null });
    expect(response.headers.get("cache-control")).toBe("no-store");
    mocks.get.mockResolvedValue(null);
    expect((await GET(new Request(url), context)).status).toBe(404);
  });
  it.each<Record<string, string>>([{ origin: "https://other.test" }, { "sec-fetch-site": "cross-site" }])("拒绝跨站读取 %j", async (headers) => {
    expect((await GET(new Request(url, { headers }), context)).status).toBe(403);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("拒绝错误路径及其他任务回执", async () => {
    expect((await GET(new Request(url), { params: Promise.resolve({ runId: "bad" }) })).status).toBe(400);
    mocks.get.mockResolvedValue({ ok: true, runId: "00000000-0000-4000-8000-000000000159", delivery: null });
    expect((await GET(new Request(url), context)).status).toBe(503);
  });
  it.each([{ confirmed: false }, { reason: "" }, { targetId: "other" }, { endpoint: "https://other.test" }])("严格确认，不接受越界字段 %j", async (change) => {
    expect((await POST(request({ ...input, ...change }), context)).status).toBe(400);
    expect(mocks.retry).not.toHaveBeenCalled();
  });
  it("格式、跨站和实际字节大小守卫在写操作前执行", async () => {
    expect((await POST(request(input, { origin: "https://other.test" }), context)).status).toBe(403);
    expect((await POST(request(input, { "content-type": "text/plain" }), context)).status).toBe(415);
    expect((await POST(request({ ...input, reason: "字".repeat(1500) }), context)).status).toBe(413);
    expect((await POST(new Request(url, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: "bad" }), context)).status).toBe(400);
    expect(mocks.retry).not.toHaveBeenCalled();
  });
  it("明确回执只表示登记补投，业务拒绝与未知结果区分", async () => {
    expect((await POST(request(), context)).status).toBe(200);
    expect(mocks.retry).toHaveBeenCalledWith(id, input);
    mocks.retry.mockResolvedValue({ ok: false, error: "有效期已过" });
    expect((await POST(request(), context)).status).toBe(409);
    mocks.retry.mockResolvedValue({ ok: false, error: "响应待确认", retryable: true });
    const response = await POST(request(), context);
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("2");
  });
});
