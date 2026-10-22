import { createServer } from "node:http";
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { McpConnectionRegistration } from "@/contracts/mcp-connection";
import { checkMcpConnection } from "./mcp-connection-check";
import { inspectMcpConnection, listMcpConnections } from "@/server/queries/mcp-connections";
import { POST } from "@/app/api/mcp/connections/check/route";
const registration = McpConnectionRegistration.parse({ id: "service", name: "查询服务", workspaceId: "00000000-0000-4000-8000-000000000001", endpoint: "https://service.example/mcp", headers: { Authorization: "Bearer server-secret" }, tools: [{ registryToolId: "lookup", name: "查询记录", action: "lookup", inputSchema: { type: "object" } }] });
function transport(listResult: unknown = { tools: [{ name: "lookup", inputSchema: { type: "object" } }] }, expectedEndpoint = registration.endpoint) {
  const methods: string[] = [];
  const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0], options?: RequestInit) => {
    expect(String(url)).toBe(expectedEndpoint);
    expect(options?.redirect).toBe("error"); expect(options?.credentials).toBe("omit");
    expect(new Headers(options?.headers).get("Authorization")).toBe("Bearer server-secret");
    expect(new Headers(options?.headers).get("cookie")).toBeNull();
    const rpc = JSON.parse(String(options?.body)) as { method: string; id?: number };
    methods.push(rpc.method);
    if (rpc.method === "server/discover") return Response.json({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "unsupported" } });
    if (rpc.method === "notifications/initialized") return new Response(null, { status: 202 });
    const result = rpc.method === "initialize" ? { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } } : listResult;
    return Response.json({ jsonrpc: "2.0", id: rpc.id, result });
  });
  return { fetchImpl: fetchImpl as typeof fetch, methods };
}
describe("官方 SDK 只读连接检查（模拟传输，无外部请求）", () => {
  const rejectedHeaders: Array<Record<string, string>> = [
    { Cookie: "header-private" }, { "SET-cookie": "header-private" },
    { Authorization: "header-private", authorization: "other-private" },
    { "bad header": "header-private" }, { Authorization: "header-private\r\ninjection" },
    Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`X-Fixture-${index}`, "header-private"])),
    { Authorization: "x".repeat(4001) },
  ];
  it.each(rejectedHeaders)("直接检查入口也在握手前拒绝非法请求头 %#", async (headers) => {
    const fetchImpl = vi.fn(async () => { throw new Error("不允许网络调用"); });
    const result = await checkMcpConnection({ ...registration, headers }, fetchImpl);
    expect(result).toEqual({ status: "configuration-error", message: "连接配置无效，请管理员检查", tools: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("header-private");
    expect(JSON.stringify(result)).not.toContain("other-private");
  });
  it("只握手和读取目录，绝不调用工具", async () => {
    const { fetchImpl, methods } = transport();
    expect((await checkMcpConnection(registration, fetchImpl)).status).toBe("available");
    expect(methods).toEqual(["server/discover", "initialize", "notifications/initialized", "tools/list"]);
    expect(methods).not.toContain("tools/call");
  });
  it.each([401, 403])("凭据拒绝 %i 不触发 OAuth 或泄露响应", async (status) => {
    const fetchImpl = vi.fn(async () => new Response("server-secret", { status }));
    const result = await checkMcpConnection(registration, fetchImpl);
    expect(result.status).toBe("credentials-rejected");
    expect(JSON.stringify(result)).not.toContain("server-secret");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each([408, 409, 425, 429, 503])("临时错误 %i 不自动重试", async (status) => {
    const fetchImpl = vi.fn(async () => new Response("secret", { status }));
    expect((await checkMcpConnection(registration, fetchImpl)).status).toBe("unavailable");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("拒绝重定向响应和非法协议", async () => {
    expect((await checkMcpConnection(registration, async () => new Response(null, { status: 302, headers: { location: "https://other.example" } }))).status).toBe("protocol-error");
    expect((await checkMcpConnection(registration, async () => Response.json({ secret: true }))).status).toBe("protocol-error");
  });
  it("重复分页游标失败，不将部分目录报为成功", async () => {
    const { fetchImpl, methods } = transport({ tools: [{ name: "lookup", inputSchema: { type: "object" } }], nextCursor: "repeat" });
    expect((await checkMcpConnection(registration, fetchImpl)).status).toBe("protocol-error");
    expect(methods.filter((method) => method === "tools/list")).toHaveLength(2);
  });
  it("拒绝跨页重复工具及目录变化", async () => {
    const duplicate = transport({ tools: [{ name: "lookup", inputSchema: { type: "object" } }, { name: "lookup", inputSchema: { type: "object" } }] });
    expect((await checkMcpConnection(registration, duplicate.fetchImpl)).status).toBe("protocol-error");
    const changed = transport({ tools: [{ name: "lookup", inputSchema: { type: "object", required: ["term"] } }] });
    expect((await checkMcpConnection(registration, changed.fetchImpl)).status).toBe("definition-changed");
  });
  it("拒绝有声明和无声明的超大响应", async () => {
    expect((await checkMcpConnection(registration, async () => new Response("secret", { headers: { "content-length": String(1024 * 1024 + 1) } }))).status).toBe("protocol-error");
    expect((await checkMcpConnection(registration, async () => new Response(" ".repeat(1024 * 1024 + 1)))).status).toBe("protocol-error");
  });
  it("网络错误只返回固定消息", async () => {
    const result = await checkMcpConnection(registration, async () => { throw new Error("server-secret"); });
    expect(result.status).toBe("unavailable"); expect(JSON.stringify(result)).not.toContain("server-secret");
  });
});

it("握手建立会话后关闭会话，清理错误不修改检查结论", async () => {
  const base = transport();
  const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0], options?: RequestInit) => {
    if (options?.method === "DELETE") {
      expect(String(url)).toBe(registration.endpoint); expect(options.signal?.aborted).toBe(false);
      expect(options.credentials).toBe("omit"); expect(options.redirect).toBe("error");
      return new Response("secret", { status: 503 });
    }
    const response = await base.fetchImpl(url, options);
    if (String(options?.body).includes('"initialize"')) response.headers.set("mcp-session-id", "session");
    return response;
  });
  expect((await checkMcpConnection(registration, fetchImpl)).status).toBe("available");
  expect(fetchImpl.mock.calls.filter(([, options]) => options?.method === "DELETE")).toHaveLength(1);
  expect(base.methods).not.toContain("tools/call");
});

it("超时中止正在等待的模拟请求", async () => {
  vi.useFakeTimers();
  try {
    const fetchImpl: typeof fetch = async (_url, options) => await new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    });
    const promise = checkMcpConnection(registration, fetchImpl);
    await vi.advanceTimersByTimeAsync(10_001);
    expect((await promise).status).toBe("unavailable");
  } finally { vi.useRealTimers(); }
});

it("保留管理员 HTTPS 查询参数并兼容 SDK 根地址归一化", async () => {
  for (const endpoint of ["https://service.example/mcp?version=1", "https://service.example", "https://SERVICE.EXAMPLE/mcp?version=1"]) {
    const base = transport(undefined, new URL(endpoint).href);
    expect((await checkMcpConnection({ ...registration, endpoint }, base.fetchImpl)).status).toBe("available");
  }
});

it("本机真实 HTTP 假服务经登记查询和 API 检查入口，只握手及读取目录", async () => {
  const methods: string[] = [];
  let httpRequests = 0, unexpected = false;
  const server = createServer(async (request, response) => {
    httpRequests += 1;
    if (request.url !== "/mcp?server=fake") unexpected = true;
    if (request.headers.authorization !== "Bearer local-test-secret") unexpected = true;
    if (request.headers.cookie) unexpected = true;
    if (request.method === "DELETE") { response.writeHead(204); response.end(); return; }
    if (request.method !== "POST") { unexpected = true; response.writeHead(405); response.end(); return; }
    let body = "";
    for await (const chunk of request) body += chunk;
    const rpc = JSON.parse(body) as { method: string; id?: number };
    methods.push(rpc.method);
    if (rpc.method === "server/discover") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "unsupported" } }));
      return;
    }
    if (rpc.method === "notifications/initialized") { response.writeHead(202); response.end(); return; }
    if (rpc.method !== "initialize" && rpc.method !== "tools/list") unexpected = true;
    const result = rpc.method === "initialize"
      ? { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "local-fake", version: "1" } }
      : { tools: [{ name: "lookup", description: "untrusted-remote-text", inputSchema: { type: "object" } }] };
    response.writeHead(200, { "Content-Type": "application/json", "mcp-session-id": "local-test-session" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
  });
  try {
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("本机测试端口无效");
    const endpoint = `http://127.0.0.1:${address.port}/mcp?server=fake`;
    vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify([{ id: "local-lookup", name: "本机查询", action: "lookup", scope: "local-test", operationKind: "read", protocol: "mcp-streamable-http", endpoint, headers: { Authorization: "Bearer local-test-secret" }, inputSchema: { type: "object" }, outputSchema: { type: "object" } }]));
    expect(listMcpConnections()).toEqual([{ id: "local-lookup", name: "本机查询" }]);
    const first = await inspectMcpConnection("local-lookup");
    expect(first.status).toBe("available");
    const response = await POST(new Request("https://studio.example/api/mcp/connections/check", { method: "POST", headers: { origin: "https://studio.example", "content-type": "application/json" }, body: JSON.stringify({ connectionId: "local-lookup" }) }));
    expect(response.status).toBe(200);
    const data = await response.json(); expect(data.status).toBe("available");
    expect(JSON.stringify(data)).not.toContain("local-test-secret"); expect(JSON.stringify(data)).not.toContain(endpoint);
    expect(JSON.stringify(data)).not.toContain("untrusted-remote-text");
    expect(methods).toEqual(["server/discover", "initialize", "notifications/initialized", "tools/list", "server/discover", "initialize", "notifications/initialized", "tools/list"]);
    expect(methods).not.toContain("tools/call"); expect(unexpected).toBe(false);
    const count = httpRequests;
    expect((await inspectMcpConnection("unknown")).status).toBe("not-found"); expect(httpRequests).toBe(count);
  } finally {
    vi.unstubAllEnvs();
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
