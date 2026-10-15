import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startMcpTestServer } from "../../../tests/fixtures/mcp-server";
import { invokeMcpTool } from "./invoke-mcp-tool";
import { parseToolRegistry } from "./tool-registry";
import { toolStepIdempotencyKey } from "@/server/domain/runtime/tool-step-idempotency-key";
import { InputMapping } from "@/contracts/input-mapping";
import { MAX_MCP_TEXT_BLOCKS } from "@/contracts/mcp-tool";
import { resolveNodeInput } from "@/server/domain/runtime/input-mapping";

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
  it.each([null, "c1"])("组合参数与回执通过真实 SDK 发现和调用，保留 %j", async (customerId) => {
    const inputSchema = { type: "object", required: ["customerId"], properties: { customerId: { anyOf: [{ type: "string" }, { type: "null" }] } }, additionalProperties: false };
    const outputSchema = { ...inputSchema, properties: {
      ...inputSchema.properties,
      amount: { allOf: [{ type: "number" }, { minimum: 0 }] },
      active: { oneOf: [{ const: false }, { const: true }] },
    }, not: { required: ["error"] } };
    const output = { customerId, amount: 0, active: false };
    const { server, tool } = await fixture({ inputSchema, outputSchema, output });
    tool.outputSchema = outputSchema;
    await expect(invokeMcpTool({ tool, action: tool.action, idempotencyKey: "composition-key", input: { customerId }, outputs: { secret: "not-sent" } }))
      .resolves.toEqual({ ok: true, output });
    expect(server.messages.filter((message) => message.method === "tools/call")).toEqual([
      { method: "tools/call", key: "composition-key", params: { name: tool.action, arguments: { customerId } } },
    ]);
    expect(server.wasClosed()).toBe(true);
    expect(JSON.stringify(server.messages)).not.toContain("not-sent");
  });
  it("不匹配的组合参数在发现和副作用前拒绝", async () => {
    const inputSchema = { type: "object", properties: { customerId: { anyOf: [{ type: "string" }, { type: "null" }] } } };
    const { server, tool } = await fixture({ inputSchema });
    await expect(invokeMcpTool({ tool, action: tool.action, idempotencyKey: "composition-key", input: { customerId: false }, outputs: {} }))
      .resolves.toMatchObject({ ok: false, retryable: false });
    expect(server.messages).toHaveLength(0);
    expect(server.effectCount()).toBe(0);
  });
  it("组合的未选分支发生远端漂移，仍在业务调用前拒绝", async () => {
    const inputSchema = { type: "object", properties: { customerId: { anyOf: [{ type: "string" }, { type: "null" }] } } };
    const { server, tool } = await fixture({ inputSchema });
    tool.inputSchema = { type: "object", properties: { customerId: { anyOf: [{ type: "string" }, { type: "boolean" }] } } };
    await expect(invokeMcpTool({ tool, action: tool.action, idempotencyKey: "composition-key", input: { customerId: "c1" }, outputs: {} }))
      .resolves.toMatchObject({ ok: false, retryable: false });
    expect(server.messages.some((message) => message.method === "tools/call")).toBe(false);
    expect(server.effectCount()).toBe(0);
    expect(server.wasClosed()).toBe(true);
  });
  it.each([
    { anyOf: [{ type: "null" }, { type: "number" }] },
    { allOf: [{ type: "string" }, { const: "other" }] },
    { oneOf: [{ type: "string" }, { minLength: 1 }] },
    { not: { const: "c1" } },
  ])("真实 SDK 回执不符合组合约束时不冒充成功 %#", async (rule) => {
    const outputSchema = { type: "object", required: ["customerId"], properties: { customerId: rule } };
    const { server, tool, invoke } = await fixture({ outputSchema });
    tool.outputSchema = outputSchema;
    await expect(invoke()).resolves.toMatchObject({ ok: false, retryable: false });
    expect(server.messages.filter((message) => message.method === "tools/call")).toHaveLength(1);
    expect(server.wasClosed()).toBe(true);
  });
  it.each(["read", "action"] as const)("中文内联%s步骤的安全键仅发送到实际业务调用", async (operationKind) => {
    const { server, tool } = await fixture();
    const idempotencyKey = toolStepIdempotencyKey({ runId: "run-1", nodeId: "work.登记分支.登记", stepId: "step-1" });
    const configured = { ...tool, operationKind, businessIdempotency: true, businessIdempotencyRetentionMs: 600_000 };
    await expect(invokeMcpTool({ tool: configured, action: tool.action, idempotencyKey, input: { customerId: "c1" }, outputs: {} })).resolves.toMatchObject({ ok: true });
    expect(server.messages.filter((message) => message.method === "tools/call")).toEqual([expect.objectContaining({ key: idempotencyKey })]);
    expect(server.messages.filter((message) => message.method !== "tools/call").every((message) => message.key === undefined)).toBe(true);
  });
  it("中文内联写步骤丢失首次回执后使用相同键，真实SDK只产生一次业务效果", async () => {
    const { server, tool } = await fixture({ loseFirstResponse: true });
    const configured = { ...tool, operationKind: "action" as const, businessIdempotency: true, businessIdempotencyRetentionMs: 600_000 };
    const idempotencyKey = toolStepIdempotencyKey({ runId: "run-1", nodeId: "group.登记", stepId: "step-1" });
    const invoke = () => invokeMcpTool({ tool: configured, action: tool.action, idempotencyKey, input: { customerId: "c1" }, outputs: {} });
    await expect(invoke()).resolves.toMatchObject({ ok: false, retryable: true });
    await expect(invoke()).resolves.toMatchObject({ ok: true });
    expect(server.messages.filter((message) => message.method === "tools/call").map((message) => message.key)).toEqual([idempotencyKey, idempotencyKey]);
    expect(server.effectCount()).toBe(1);
  });
  it("历史中文原始键在业务调用前失败，不冒充已发送或触发业务副作用", async () => {
    const { server, tool } = await fixture();
    await expect(invokeMcpTool({ tool, action: tool.action, idempotencyKey: "run-1:group.登记:step-1", input: { customerId: "c1" }, outputs: {} }))
      .resolves.toMatchObject({ ok: false, retryable: false });
    expect(server.messages.filter((message) => message.method === "tools/call")).toHaveLength(0);
    expect(server.effectCount()).toBe(0);
  });
  const rejectedHeaders: Array<Record<string, string>> = [
    { Cookie: "header-private" }, { "SET-cookie": "header-private" },
    { Authorization: "header-private", authorization: "other-private" },
    { "bad header": "header-private" }, { Authorization: "header-private\r\ninjection" },
    Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`X-Fixture-${index}`, "header-private"])),
    { Authorization: "x".repeat(4001) },
  ];
  it.each(rejectedHeaders)("非法请求头在发现和业务调用前拒绝，不泄露凭据 %#", async (headers) => {
    const tool = parseToolRegistry(JSON.stringify([{
      id: "lookup", name: "读取资料", action: "lookup", scope: "read", protocol: "mcp-streamable-http",
      operationKind: "read", endpoint: "https://fixture.example/mcp", inputSchema: { type: "object" },
    }]))[0];
    expect(tool).toBeDefined();
    const fetchImpl = vi.fn(async () => { throw new Error("不允许网络调用"); });
    const result = await invokeMcpTool({ tool: { ...tool, headers }, action: tool.action, idempotencyKey: "fixture-key", input: {}, outputs: {}, fetchImpl });
    expect(result).toEqual({ ok: false, error: "远端工具连接配置无效，请检查服务端登记", retryable: false });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("header-private");
    expect(JSON.stringify(result)).not.toContain("other-private");
  });
  it("合法认证仍执行，发现与业务请求都禁用环境 Cookie", async () => {
    const { server, tool } = await fixture();
    const fetchImpl = vi.fn(async (url: Parameters<typeof fetch>[0], options?: RequestInit) => {
      expect(options?.credentials).toBe("omit");
      expect(options?.redirect).toBe("error");
      expect(new Headers(options?.headers).get("cookie")).toBeNull();
      expect(new Headers(options?.headers).get("authorization")).toBe("Bearer test-only");
      return fetch(url, options);
    });
    await expect(invokeMcpTool({ tool, action: tool.action, idempotencyKey: "fixture-key", input: { customerId: "c1" }, outputs: {}, fetchImpl }))
      .resolves.toEqual({ ok: true, output: { customerId: "c1", amount: 0, active: false } });
    expect(fetchImpl).toHaveBeenCalled();
    expect(server.messages.filter((message) => message.method === "tools/call")).toHaveLength(1);
    expect(server.wasClosed()).toBe(true);
  });
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
  it("远端已公布回执定义与冻结契约一致时继续调用", async () => {
    const outputSchema = { type: "object", properties: { customerId: { type: "string" } }, required: ["customerId"] };
    const { server, tool, invoke } = await fixture({ outputSchema });
    tool.outputSchema = { required: ["customerId"], properties: { customerId: { type: "string" } }, type: "object" };
    await expect(invoke()).resolves.toMatchObject({ ok: true });
    expect(server.messages.filter((message) => message.method === "tools/call")).toHaveLength(1);
    expect(server.wasClosed()).toBe(true);
  });
  it.each(["read", "action"] as const)("远端回执定义变化或非法时，%s 操作在副作用前永久拒绝", async (operationKind) => {
    const { server, tool, invoke } = await fixture({ outputSchema: { type: "object", properties: { customerId: { type: "number" } }, description: "fixture-private" } });
    Object.assign(tool, { operationKind, businessIdempotency: true, businessIdempotencyRetentionMs: 600_000 });
    const result = await invoke();
    expect(result).toEqual({ ok: false, retryable: false, error: "远端工具回执规则已变化或无效，请核对并重新发布助手" });
    expect(server.messages.some((message) => message.method === "tools/call")).toBe(false);
    expect(server.wasClosed()).toBe(true);
    expect(JSON.stringify(result)).not.toContain("fixture-private");
  });
  it("SDK 可解析但不支持的回执定义不执行业务请求", async () => {
    const { server, invoke } = await fixture({ outputSchema: { type: "object", $ref: "fixture-private" } });
    await expect(invoke()).resolves.toMatchObject({ ok: false, retryable: false });
    expect(server.messages.some((message) => message.method === "tools/call")).toBe(false);
    expect(server.wasClosed()).toBe(true);
  });
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

describe("真实 MCP SDK 只读文本及下游字段映射", () => {
  const textSchema = { type: "object", required: ["text"], properties: { text: { type: "string" } }, additionalProperties: false };
  it.each([false, true])("普通与事件流文本可送入下游，注解和未选上游不会混入 %s", async (sse) => {
    const parts = ["# 公开资料\n\n原文甲", "原文乙\n"];
    const { server, tool, invoke } = await fixture({ sse, content: parts.map((text) => ({ type: "text", text, annotations: { audience: ["assistant"] }, metadata: "非正文" })) });
    tool.outputSchema = textSchema;
    const result = await invoke();
    expect(result).toEqual({ ok: true, output: { text: parts.join("\n\n") } });
    if (!result.ok) throw new Error("只读文本应成功");
    const node = { title: "整理资料", inputMapping: InputMapping.parse({ fields: [{ target: ["source"], source: { kind: "output", nodeId: "read", path: ["text"] } }] }) };
    expect(resolveNodeInput({ node, input: { private: "未选择的输入" }, outputs: { read: result.output, other: { secret: "未选择的上游" } } }))
      .toEqual({ ok: true, input: { source: parts.join("\n\n") }, outputs: {} });
    expect(server.messages.filter((message) => message.method === "tools/call")).toEqual([
      { method: "tools/call", key: "stable-business-key", params: { name: "lookup_customer", arguments: { customerId: "c1" } } },
    ]);
    expect(server.wasClosed()).toBe(true);
  });
  it.each(["", "普通文字", "0", "false", "null", "[]"])("单段非对象文字保留原文 %s", async (text) => {
    const { tool, invoke } = await fixture({ text });
    tool.outputSchema = textSchema;
    await expect(invoke()).resolves.toEqual({ ok: true, output: { text } });
  });
  it("空内容代表空查询结果而非伪造成功业务字段", async () => {
    const { tool, invoke } = await fixture({ content: [] });
    tool.outputSchema = textSchema;
    await expect(invoke()).resolves.toEqual({ ok: true, output: { text: "" } });
  });
  it.each([false, true])("文本即使符合本地字段，声明了远端结构化定义仍不能绕过 %s", async (multiple) => {
    const { server, tool, invoke } = await fixture({ outputSchema: textSchema, content: multiple ? [{ type: "text", text: "甲" }, { type: "text", text: "乙" }] : [{ type: "text", text: "资料" }] });
    tool.outputSchema = textSchema;
    await expect(invoke()).resolves.toMatchObject({ ok: false, retryable: false });
    expect(server.messages.filter((message) => message.method === "tools/call")).toHaveLength(1);
    expect(server.wasClosed()).toBe(true);
  });
  it.each([false, true])("已确认防重的写工具仍不能把普通或多段文字当成功回执 %s", async (multiple) => {
    const { server, tool } = await fixture({ content: multiple ? [{ type: "text", text: "甲" }, { type: "text", text: "乙" }] : [{ type: "text", text: "已完成" }] });
    const configured = { ...tool, outputSchema: textSchema, operationKind: "action" as const, businessIdempotency: true, businessIdempotencyRetentionMs: 600_000 };
    await expect(invokeMcpTool({ tool: configured, action: configured.action, idempotencyKey: "write-key", input: { customerId: "c1" }, outputs: {} }))
      .resolves.toMatchObject({ ok: false, retryable: false });
    expect(server.messages.filter((message) => message.method === "tools/call")).toHaveLength(1);
    expect(server.wasClosed()).toBe(true);
  });
  it.each([null, { ok: false }, { text: 1 }])("真实 SDK 结构化错误不能被备用正文掩盖 %#", async (output) => {
    const { tool, invoke } = await fixture({ output, text: "备用文字" });
    tool.outputSchema = textSchema;
    await expect(invoke()).resolves.toMatchObject({ ok: false, retryable: false });
  });
  it("单段失败对象 JSON 不重新包装成成功文字", async () => {
    const { tool, invoke } = await fixture({ text: '{"ok":false,"text":"未完成"}' });
    tool.outputSchema = textSchema;
    await expect(invoke()).resolves.toMatchObject({ ok: false, retryable: false });
  });
  it("isError 优先于文本适配且不回显远端错误", async () => {
    const { tool, invoke } = await fixture({ isError: true, text: "fixture-private-secret" });
    tool.outputSchema = textSchema;
    const result = await invoke();
    expect(result).toMatchObject({ ok: false, retryable: false });
    expect(JSON.stringify(result)).not.toContain("fixture-private-secret");
  });
  it.each([
    [{ type: "text", text: "部分正文" }, { type: "image", data: "AA==", mimeType: "image/png" }],
    [{ type: "resource_link", uri: "https://fixture.example/private", name: "附件" }],
    [{ type: "audio", data: "AA==", mimeType: "audio/wav" }],
    Array.from({ length: MAX_MCP_TEXT_BLOCKS + 1 }, () => ({ type: "text", text: "资料" })),
  ].map((content) => ({ content })))("真实 SDK 的混合内容和超限块数不静默裁剪 %#", async ({ content }) => {
    const { server, tool, invoke } = await fixture({ content });
    tool.outputSchema = textSchema;
    await expect(invoke()).resolves.toMatchObject({ ok: false, retryable: false });
    expect(server.wasClosed()).toBe(true);
  });
  it.each(["汉".repeat(400_000), "\n".repeat(600_000)])("超限原文仍被真实传输字节边界拒绝 %#", async (text) => {
    const { tool, invoke } = await fixture({ text });
    tool.outputSchema = textSchema;
    await expect(invoke()).resolves.toMatchObject({ ok: false, retryable: false });
  });
});

describe("真实 MCP SDK 复用本地字段定义", () => {
  it.each(["$defs", "definitions"].flatMap((keyword) => (["read", "action"] as const).map((operationKind) => ({ keyword, operationKind }))))("$operationKind 工具完整发现并校验 $keyword 的嵌套参数和回执", async ({ keyword, operationKind }) => {
    const inputSchema = { type: "object", required: ["customer", "lines"], additionalProperties: false, properties: {
      customer: { $ref: `#/${keyword}/Customer` }, lines: { type: "array", items: { $ref: `#/${keyword}/Line` } },
    }, [keyword]: {
      Customer: { type: "object", required: ["id"], properties: { id: { type: "string" } }, additionalProperties: false },
      Line: { type: "object", required: ["amount", "active"], properties: { amount: { type: "number", minimum: 0 }, active: { type: "boolean" } }, additionalProperties: false },
    } };
    const outputSchema = { type: "object", required: ["receipt"], properties: { receipt: { $ref: `#/${keyword}/Receipt` } }, [keyword]: {
      Receipt: { type: "object", required: ["id", "amount", "active"], properties: { id: { type: "string" }, amount: { type: "number" }, active: { type: "boolean" } }, additionalProperties: false },
    } };
    const input = { customer: { id: "c1" }, lines: [{ amount: 0, active: false }] }, output = { receipt: { id: "receipt-1", amount: 0, active: false } };
    const { server, tool } = await fixture({ inputSchema, outputSchema, output });
    const configured = { ...tool, outputSchema, operationKind, businessIdempotency: true, businessIdempotencyRetentionMs: 600_000 };
    expect(parseToolRegistry(JSON.stringify([configured]))).toHaveLength(1);
    await expect(invokeMcpTool({ tool: configured, action: configured.action, idempotencyKey: "local-definition-key", input, outputs: { private: "not-sent" } }))
      .resolves.toEqual({ ok: true, output });
    expect(server.messages.filter((message) => message.method === "tools/call")).toEqual([
      { method: "tools/call", key: "local-definition-key", params: { name: configured.action, arguments: input } },
    ]);
    expect(server.wasClosed()).toBe(true);
  });
  it("引用规则不符的参数在连接和业务效果前拒绝", async () => {
    const inputSchema = { type: "object", properties: { customerId: { $ref: "#/$defs/Id" } }, $defs: { Id: { type: "integer" } } };
    const { server, tool } = await fixture({ inputSchema });
    await expect(invokeMcpTool({ tool, action: tool.action, idempotencyKey: "local-definition-key", input: { customerId: false }, outputs: {} })).resolves.toMatchObject({ ok: false, retryable: false });
    expect(server.messages).toHaveLength(0); expect(server.effectCount()).toBe(0);
  });
  it("远端只改变复用输入定义，也须在业务调用前阻止漂移", async () => {
    const inputSchema = { type: "object", properties: { customerId: { $ref: "#/$defs/Id" } }, $defs: { Id: { type: "string", minLength: 2 } } };
    const { server, tool, invoke } = await fixture({ inputSchema });
    tool.inputSchema = { ...inputSchema, $defs: { Id: { type: "string", minLength: 1 } } };
    await expect(invoke()).resolves.toMatchObject({ ok: false, retryable: false });
    expect(server.messages.some((message) => message.method === "tools/call")).toBe(false);
    expect(server.effectCount()).toBe(0); expect(server.wasClosed()).toBe(true);
  });
  it("未使用的远端回执定义变化也不能从冻结比对丢掉", async () => {
    const outputSchema = { type: "object", properties: { customerId: { $ref: "#/$defs/Id" } }, $defs: { Id: { type: "string" }, Unused: { const: "one" } } };
    const { server, tool, invoke } = await fixture({ outputSchema });
    tool.outputSchema = { ...outputSchema, $defs: { ...outputSchema.$defs, Unused: { const: "two" } } };
    await expect(invoke()).resolves.toMatchObject({ ok: false, retryable: false });
    expect(server.messages.some((message) => message.method === "tools/call")).toBe(false);
    expect(server.effectCount()).toBe(0); expect(server.wasClosed()).toBe(true);
  });
  it("声明与冻结一致仍须检查实际回执的引用字段类型", async () => {
    const outputSchema = { type: "object", required: ["customerId"], properties: { customerId: { $ref: "#/$defs/Id" } }, $defs: { Id: { type: "string" } } };
    const { server, tool, invoke } = await fixture({ outputSchema, output: { customerId: 0 } });
    tool.outputSchema = outputSchema;
    await expect(invoke()).resolves.toMatchObject({ ok: false, retryable: false });
    expect(server.messages.filter((message) => message.method === "tools/call")).toHaveLength(1);
    expect(server.wasClosed()).toBe(true);
  });
});
