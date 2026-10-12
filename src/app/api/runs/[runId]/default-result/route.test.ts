import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), action: vi.fn() }));
vi.mock("@/server/queries/default-result-deliveries", () => ({ getDefaultResultDelivery: mocks.query }));
vi.mock("@/server/actions/recover-default-result", () => ({ recoverDefaultResultAction: mocks.action }));
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { GET, POST } from "./route";

const runId = "11111111-1111-4111-8111-111111111111";
const url = "http://localhost/api/runs/" + runId + "/default-result";
const context = { params: Promise.resolve({ runId }) };
const delivery = {
  runId, status: "confirmed", writeAttempts: 1, error: null,
  createdAt: "2026-10-12T00:00:00.000Z", updatedAt: "2026-10-12T00:00:00.000Z",
  confirmedAt: "2026-10-12T00:00:00.000Z", canRetry: false, canVerify: false,
};
function request(body = '{"mode":"retry"}', headers: Record<string, string> = {}) {
  return new Request(url, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", ...headers }, body });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.query.mockResolvedValue(delivery);
  mocks.action.mockResolvedValue({ ok: true, delivery, workflowNotified: true });
});
describe("成果核对接口保持范围与请求边界", () => {
  it("读取仅用服务端工作区且不缓存投递状态", async () => {
    const response = await GET(new Request(url), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ delivery });
    expect(mocks.query).toHaveBeenCalledWith(runId, DEMO_WORKSPACE_ID);
    expect(mocks.action).not.toHaveBeenCalled();
  });
  it("跨站读取不访问后端", async () => {
    expect((await GET(new Request(url, { headers: { origin: "https://other.test" } }), context)).status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it("恢复只传路径任务和严格mode，不允许覆盖归属", async () => {
    expect((await POST(request(), context)).status).toBe(200);
    expect(mocks.action).toHaveBeenCalledWith({ runId, mode: "retry" });
  });
  it.each(["runId", "workspaceId", "sdkRunId", "producerSettled", "frameHash"])("客户端%s会被拒绝而非悄悄覆盖", async (field) => {
    const response = await POST(request(JSON.stringify({ mode: "retry", [field]: "untrusted" })), context);
    expect(response.status).toBe(400);
    expect(mocks.action).not.toHaveBeenCalled();
  });
  it("无同源确认不能补送", async () => {
    expect((await POST(request(undefined, { origin: "https://other.test" }), context)).status).toBe(403);
    expect(mocks.action).not.toHaveBeenCalled();
  });
  it("非JSON、坏JSON及超过4KB不会调用动作", async () => {
    expect((await POST(request("mode=retry", { "content-type": "text/plain" }), context)).status).toBe(415);
    expect((await POST(request("{"), context)).status).toBe(400);
    expect((await POST(request("x".repeat(4097)), context)).status).toBe(413);
    expect(mocks.action).not.toHaveBeenCalled();
  });
  it("错误任务、额外内部数据或动作异常不返回敏感内容", async () => {
    mocks.query.mockResolvedValue({ ...delivery, runId: "22222222-2222-4222-8222-222222222222" });
    expect((await GET(new Request(url), context)).status).toBe(503);
    mocks.action.mockResolvedValue({ ok: true, delivery: { ...delivery, sdkRunId: "private" }, workflowNotified: true });
    const response = await POST(request(), context);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("private");
  });
});
