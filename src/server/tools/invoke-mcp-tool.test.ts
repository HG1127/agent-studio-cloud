import { afterEach, describe, expect, it } from "vitest";
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
