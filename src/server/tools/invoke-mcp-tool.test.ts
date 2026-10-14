import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startMcpTestServer } from "../../../tests/fixtures/mcp-server";
import { invokeMcpTool } from "./invoke-mcp-tool";
import { parseToolRegistry } from "./tool-registry";

const servers: Array<Awaited<ReturnType<typeof startMcpTestServer>>> = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); });
async function fixture(options: Parameters<typeof startMcpTestServer>[0] = {}) {
  const server = await startMcpTestServer(options); servers.push(server);
  const tool = parseToolRegistry(JSON.stringify([{
    id: "customer.lookup", name: "查询客户", action: "lookup_customer", scope: "customer.read", risk: "low",
    protocol: "mcp-streamable-http", operationKind: "read", endpoint: server.endpoint, inputSchema: server.schema,
    headers: { Authorization: "Bearer test-only" },
    outputSchema: { type: "object", required: ["customerId"], properties: { customerId: { type: "string" }, amount: { type: "number" }, active: { type: "boolean" } }, additionalProperties: false },
  }]))[0];
  const invoke = () => invokeMcpTool({ tool, action: tool.action, idempotencyKey: "stable-business-key", input: { customerId: "c1" }, outputs: { secret: "not-sent" } });
  return { server, tool, invoke };
}

describe("真实 MCP SDK 对本地 Streamable HTTP 服务", () => {
  it.each([
    { type: "object", description: "汉".repeat(12_000) },
    { type: "object", description: "x".repeat(32 * 1024 - 20) },
    {}, { type: ["object", "null"] }, { type: "string" },
  ])("登记定义不可执行时永久拒绝，连发现请求也不能发送 %#", async (inputSchema) => {
    const tool = parseToolRegistry(JSON.stringify([{ id: "lookup", name: "读取资料", action: "lookup", scope: "read", protocol: "mcp-streamable-http", operationKind: "read", endpoint: "https://fixture.example/mcp", inputSchema }]))[0];
    expect(tool).toBeDefined();
    const fetchImpl = vi.fn(async () => { throw new Error("虚构输送不允许网络访问"); });
    const result = await invokeMcpTool({ tool, action: tool.action, idempotencyKey: "fixture-key", input: {}, outputs: {}, fetchImpl });
    expect(result).toMatchObject({ ok: false, retryable: false, error: expect.stringContaining("参数定义") });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([
    { name: "根地址不带尾斜线", endpoint: (value: string) => new URL(value).origin },
    { name: "协议大小写等价", endpoint: (value: string) => value.replace("http:", "HTTP:") },
    { name: "规范化相对路径段", endpoint: (value: string) => `${new URL(value).origin}/unused/../mcp` },
    { name: "根地址保留查询参数", endpoint: (value: string) => `${new URL(value).origin}?mode=fixture` },
  ])("规范化登记地址并保持唯一传输目标：$name", async ({ endpoint }) => {
    const { server, tool } = await fixture();
    tool.endpoint = endpoint(server.endpoint);
    const requests: string[] = [];
    const result = await invokeMcpTool({
      tool, action: tool.action, idempotencyKey: "normalized-key", input: { customerId: "c1" }, outputs: {},
      fetchImpl: async (url, options) => { requests.push(String(url)); return fetch(url, options); },
    });
    expect(result).toMatchObject({ ok: true });
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.every((url) => url === new URL(tool.endpoint).href)).toBe(true);
    expect(server.messages.filter((message) => message.method === "tools/call")).toHaveLength(1);
    expect(server.wasClosed()).toBe(true);
  });
  it.each(["invalid-endpoint", "file:///fixture", "https://fixture:fixture@example.test/mcp"])("非法登记地址在网络调用前永久拒绝：%s", async (endpoint) => {
    const { server, tool } = await fixture();
    tool.endpoint = endpoint;
    const requests: string[] = [];
    const result = await invokeMcpTool({
      tool, action: tool.action, idempotencyKey: "invalid-key", input: { customerId: "c1" }, outputs: {},
      fetchImpl: async (url, options) => { requests.push(String(url)); return fetch(url, options); },
    });
    expect(result).toMatchObject({ ok: false, retryable: false });
    expect(requests).toHaveLength(0);
    expect(server.messages).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain(endpoint);
  });
  it("规范化根地址后仍拒绝跟随重定向", async () => {
    const { server, tool } = await fixture();
    let redirectRequests = 0;
    const redirectServer = createServer((_request, response) => {
      redirectRequests += 1;
      response.writeHead(307, { location: server.endpoint }); response.end();
    });
    await new Promise<void>((resolve, reject) => redirectServer.listen(0, "127.0.0.1", resolve).once("error", reject));
    try {
      const address = redirectServer.address();
      if (!address || typeof address === "string") throw new Error("本地服务未启动");
      tool.endpoint = `http://127.0.0.1:${address.port}`;
      const result = await invokeMcpTool({ tool, action: tool.action, idempotencyKey: "redirect-key", input: { customerId: "c1" }, outputs: {} });
      expect(result).toMatchObject({ ok: false });
      expect(redirectRequests).toBeGreaterThan(0);
      expect(server.messages).toHaveLength(0);
    } finally {
      redirectServer.closeAllConnections();
      await new Promise<void>((resolve, reject) => redirectServer.close((error) => error ? reject(error) : resolve()));
    }
  });
  it.each([false, true])("发现指定工具、调用并关闭连接，支持事件流回执 %s", async (sse) => {
    const { server, invoke } = await fixture({ sse });
    await expect(invoke()).resolves.toEqual({ ok: true, output: { customerId: "c1", amount: 0, active: false } });
    expect(server.messages.map((m) => m.method)).toContain("initialize");
    expect(server.messages.filter((m) => m.method === "tools/call")).toEqual([{ method: "tools/call", key: "stable-business-key", params: { name: "lookup_customer", arguments: { customerId: "c1" } } }]);
    expect(server.messages.filter((m) => m.method !== "tools/call").every((m) => !m.key)).toBe(true);
    expect(JSON.stringify(server.messages)).not.toContain("not-sent"); expect(server.wasClosed()).toBe(true);
  });
  it("支持有界目录分页", async () => { const { invoke } = await fixture({ paginate: true }); await expect(invoke()).resolves.toMatchObject({ ok: true }); });
  it("单段对象格式文本兼容旧服务", async () => { const { invoke } = await fixture({ text: '{"customerId":"c1"}' }); await expect(invoke()).resolves.toEqual({ ok: true, output: { customerId: "c1" } }); });
  it.each([{ drift: true }, { missing: true }, { duplicate: true }, { cursorCycle: true }])("目录变化或异常时不执行业务工具 %j", async (options) => {
    const { server, invoke } = await fixture(options);
    await expect(invoke()).resolves.toMatchObject({ ok: false, retryable: false });
    expect(server.messages.some((m) => m.method === "tools/call")).toBe(false); expect(server.wasClosed()).toBe(true);
  });
  it.each([{ isError: true }, { output: { customerId: 1 } }, { text: "普通文字不冒充对象" }, { output: { ok: false } }, { invalidUtf8: true }, { text: "中".repeat(400_000) }])("业务错误、非法字段和超限回执不成功", async (options) => {
    const { invoke } = await fixture(options);
    const result = await invoke(); expect(result).toMatchObject({ ok: false, retryable: false });
    expect(JSON.stringify(result).length).toBeLessThan(200); expect(JSON.stringify(result)).not.toContain("never-log");
  });
  it.each([401, 403, 400, 429, 503])("HTTP %s 分类且 SDK 不隐式重试工具调用", async (status) => {
    const { server, invoke } = await fixture({ status });
    await expect(invoke()).resolves.toMatchObject({ ok: false, retryable: status === 429 || status === 503 });
    expect(server.messages.filter((m) => m.method === "tools/call")).toHaveLength(1);
  });
  it("未确认防重的写操作在建连接前拒绝", async () => {
    const { server, tool } = await fixture();
    await expect(invokeMcpTool({ tool: { ...tool, operationKind: "action" }, action: tool.action, idempotencyKey: "key", input: { customerId: "c1" }, outputs: {} })).resolves.toMatchObject({ ok: false, retryable: false });
    expect(server.messages).toHaveLength(0);
  });
  it("已确认防重的写操作复用步骤键，不发上游全集", async () => {
    const { server, tool } = await fixture();
    await expect(invokeMcpTool({ tool: { ...tool, operationKind: "action", businessIdempotency: true, businessIdempotencyRetentionMs: 600_000 }, action: tool.action, idempotencyKey: "write-key", input: { customerId: "c1" }, outputs: {} })).resolves.toMatchObject({ ok: true });
    expect(server.messages.find((m) => m.method === "tools/call")?.key).toBe("write-key");
  });
  it("参数缺失时不连接", async () => {
    const { server, tool } = await fixture();
    await expect(invokeMcpTool({ tool, action: tool.action, idempotencyKey: "key", input: {}, outputs: {} })).resolves.toMatchObject({ ok: false });
    expect(server.messages).toHaveLength(0);
  });
});
