import { beforeEach, describe, expect, it, vi } from "vitest";
const inspect = vi.hoisted(() => vi.fn());
vi.mock("@/server/queries/mcp-connections", () => ({ inspectMcpConnection: inspect }));
import { POST } from "./route";
function request(body: unknown, origin: string | null = "https://studio.example") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin) headers.origin = origin;
  return new Request("https://studio.example/api/mcp/connections/check", { method: "POST", headers, body: JSON.stringify(body) });
}
beforeEach(() => { vi.clearAllMocks(); inspect.mockResolvedValue({ status: "available", message: "定义检查通过", tools: [] }); });
describe("连接检查入口", () => {
  it("同源请求只传递登记标识且响应禁止缓存", async () => {
    const response = await POST(request({ connectionId: "lookup" }));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(inspect).toHaveBeenCalledWith("lookup");
  });
  it.each([null, "https://other.example"])("拒绝缺少或跨站来源 %s", async (origin) => {
    expect((await POST(request({ connectionId: "lookup" }, origin))).status).toBe(403);
    expect(inspect).not.toHaveBeenCalled();
  });
  it("拒绝客户端地址凭据及超过容量的消息", async () => {
    expect((await POST(request({ connectionId: "lookup", endpoint: "https://evil.example" }))).status).toBe(400);
    expect((await POST(request({ connectionId: "lookup", headers: { Authorization: "secret" } }))).status).toBe(400);
    expect((await POST(request({ connectionId: "x".repeat(2000) }))).status).toBe(400);
    expect(inspect).not.toHaveBeenCalled();
  });
  it("无效 JSON 不启动检查，未知登记返回 404", async () => {
    const invalid = new Request("https://studio.example/api/mcp/connections/check", { method: "POST", headers: { origin: "https://studio.example" }, body: "{" });
    expect((await POST(invalid)).status).toBe(400); expect(inspect).not.toHaveBeenCalled();
    inspect.mockResolvedValue({ status: "not-found", message: "未找到已登记的连接", tools: [] });
    expect((await POST(request({ connectionId: "unknown" }))).status).toBe(404);
  });
});
