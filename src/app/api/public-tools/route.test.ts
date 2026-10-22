import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ list: vi.fn(), manage: vi.fn(), call: vi.fn(), read: vi.fn(), receipt: vi.fn() }));
vi.mock("@/server/actions/public-agent-tools", () => ({ listPublicToolsAction: mocks.list, managePublicToolAction: mocks.manage,
  callPublicToolAction: mocks.call, readPublicToolAction: mocks.read, readPublicToolCallAction: mocks.receipt }));
import { GET, POST } from "./route";
import { POST as manage } from "./[toolId]/manage/route";
import { POST as call } from "./[toolId]/calls/route";
import { GET as receipt } from "./[toolId]/calls/[requestId]/route";
import { MAX_PUBLIC_TOOL_MANAGE_BYTES, MAX_PUBLIC_TOOL_REQUEST_BYTES } from "@/contracts/public-agent-tool";
import { presentPublicToolCall } from "@/server/domain/public-agent-tool";
import { publicToolTestCall, publicToolTestView, PUBLIC_TOOL_TEST_IDS as ids } from "../../../../tests/fixtures/public-agent-tool";

const origin = "https://tools.example", admin = "test-admin-".repeat(4), token = "pat_" + "a".repeat(64);
afterEach(() => vi.unstubAllEnvs());
const context = () => ({ params: Promise.resolve({ toolId: ids.tool }) });
function request(path = "/api/public-tools", body?: unknown, credential = admin, headers = {}) {
  return new Request(origin + path, { method: body === undefined ? "GET" : "POST",
    headers: { authorization: "Bearer " + credential, "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("PUBLIC_AGENT_TOOLS_ADMIN_TOKEN", admin);
  mocks.list.mockResolvedValue({ ok: true, tools: [], truncated: false });
  mocks.manage.mockResolvedValue({ ok: true, tool: publicToolTestView(), recordedRevision: 2 });
  mocks.call.mockResolvedValue({ ok: true, call: presentPublicToolCall(publicToolTestCall(), null) });
  mocks.receipt.mockResolvedValue({ ok: true, call: presentPublicToolCall(publicToolTestCall(), null) });
});
describe("公开工具 HTTP mock 边界", () => {
  it("匿名、查询凭据和跨站请求被拒绝，未读取业务数据", async () => {
    for (const req of [new Request(origin + "/api/public-tools"), request("/api/public-tools?token=never-query"), request("/api/public-tools", undefined, admin, { origin: "https://other.example" })]) {
      expect((await GET(req)).status).toBe(401);
    }
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("服务器调用不用浏览器 Origin，回执无缓存且不提供 CORS", async () => {
    const response = await call(request(`/api/public-tools/${ids.tool}/calls`, { requestId: ids.request, input: { amount: 0, approved: false } }, token), context());
    expect(response.status).toBe(202); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(mocks.call).toHaveBeenCalledWith(token, ids.tool, { requestId: ids.request, input: { amount: 0, approved: false } });
    expect(await response.json()).toMatchObject({ call: { received: true, state: "start_unknown", deliveryConfirmed: false } });
  });
  it("正文和路径工具归属不同或管理凭据错误不进入写动作", async () => {
    const body = { operation: "disable", toolId: ids.agent, expectedRevision: 2, requestId: ids.request, confirmed: true };
    expect((await manage(request(`/api/public-tools/${ids.tool}/manage`, body), context())).status).toBe(400);
    expect((await POST(request("/api/public-tools", { operation: "create", name: "工具", requestId: ids.request, confirmed: true }, token))).status).toBe(401);
    expect(mocks.manage).not.toHaveBeenCalled();
  });
  it.each(["declared", "actual"])("管理 %s 超限拒绝，调用也用实际 UTF-8 字节", async (kind) => {
    const req = kind === "declared" ? request("/api/public-tools", {}, admin, { "content-length": String(MAX_PUBLIC_TOOL_MANAGE_BYTES + 1) })
      : new Request(origin + "/api/public-tools", { method: "POST", headers: { authorization: "Bearer " + admin, "content-type": "application/json" }, body: "中".repeat(MAX_PUBLIC_TOOL_MANAGE_BYTES) });
    expect((await POST(req)).status).toBe(413);
    expect(mocks.manage).not.toHaveBeenCalled();
    const tooLarge = request(`/api/public-tools/${ids.tool}/calls`, {}, token, { "content-length": String(MAX_PUBLIC_TOOL_REQUEST_BYTES + 1) });
    expect((await call(tooLarge, context())).status).toBe(413); expect(mocks.call).not.toHaveBeenCalled();
  });
  it("资源与未知状态按真实错误映射，不包含原异常或启动新任务", async () => {
    mocks.call.mockResolvedValueOnce({ ok: false, code: "resource_limit", error: "资源已满", retryable: true });
    const req = () => request(`/api/public-tools/${ids.tool}/calls`, { requestId: ids.request, input: {} }, token);
    expect((await call(req(), context())).status).toBe(429);
    mocks.call.mockRejectedValueOnce(new Error("password=never-return-private"));
    const response = await call(req(), context());
    expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("never-return-private");
    const read = await receipt(request(`/api/public-tools/${ids.tool}/calls/${ids.request}`, undefined, token), { params: Promise.resolve({ toolId: ids.tool, requestId: ids.request }) });
    expect(read.status).toBe(200);
    expect(mocks.receipt).toHaveBeenCalledWith(token, { toolId: ids.tool, requestId: ids.request });
  });
});
