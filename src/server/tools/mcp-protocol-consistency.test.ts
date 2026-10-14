import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { McpConnectionRegistration } from "@/contracts/mcp-connection";
import { checkMcpConnection } from "./mcp-connection-check";
import { invokeMcpTool } from "./invoke-mcp-tool";
import { parseToolRegistry } from "./tool-registry";

const schema = { type: "object", additionalProperties: false };
const registered = { name: "lookup", inputSchema: schema };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map((close) => close())); });

async function fixture(options: {
  discovery?: "modern" | "legacy-rpc" | 400 | 404 | 405 | 406 | 415;
  pages?: Array<{ tools: Array<{ name: string; inputSchema: Record<string, unknown>; description?: string }>; nextCursor?: string }>;
} = {}) {
  const discovery = options.discovery ?? "modern";
  const messages: Array<{ method: string; version?: string; key?: string }> = [];
  const violations: string[] = [];
  let deletes = 0;
  const server = createServer(async (request, response) => {
    if (request.url !== "/mcp?scope=fixture" || request.headers.authorization !== "Bearer fixture-only") violations.push("target-or-credentials");
    if (request.headers.cookie) violations.push("cookie");
    if (request.method === "DELETE") { deletes += 1; response.writeHead(204); response.end(); return; }
    if (request.method !== "POST") { response.writeHead(405); response.end(); return; }
    let body = "";
    for await (const chunk of request) body += chunk;
    const rpc = JSON.parse(body) as { id: number; method: string; params?: { cursor?: string } };
    messages.push({ method: rpc.method, version: request.headers["mcp-protocol-version"] as string | undefined, key: request.headers["idempotency-key"] as string | undefined });
    const reply = (result: unknown) => {
      response.writeHead(200, { "content-type": "application/json", ...(discovery !== "modern" && rpc.method !== "server/discover" ? { "mcp-session-id": "fixture-session" } : {}) });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { ...(result as Record<string, unknown>), ...(discovery === "modern" ? { resultType: "complete" } : {}) } }));
    };
    if (rpc.method === "server/discover") {
      if (discovery === "modern") reply({ supportedVersions: ["2026-07-28"], capabilities: { tools: {} } });
      else if (typeof discovery === "number") { response.writeHead(discovery); response.end(); }
      else { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "unsupported" } })); }
    } else if (rpc.method === "initialize") {
      if (discovery === "modern") { violations.push("modern-initialize"); response.writeHead(400); response.end(); }
      else reply({ protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } });
    } else if (rpc.method === "notifications/initialized") { response.writeHead(202); response.end(); }
    else if (rpc.method === "tools/list") reply(options.pages?.[Number(rpc.params?.cursor ?? 0)] ?? { tools: [registered] });
    else if (rpc.method === "tools/call") reply({ content: [], structuredContent: { amount: 0, active: false } });
    else { violations.push("unexpected-method"); response.writeHead(400); response.end(); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("本机测试端口无效");
  const endpoint = `http://127.0.0.1:${address.port}/mcp?scope=fixture`;
  const registration = McpConnectionRegistration.parse({
    id: "lookup", name: "查询记录", workspaceId: "00000000-0000-4000-8000-000000000001", endpoint,
    headers: { Authorization: "Bearer fixture-only" }, tools: [{ registryToolId: "lookup", name: "查询记录", action: "lookup", inputSchema: schema }],
  });
  const tool = parseToolRegistry(JSON.stringify([{
    id: "lookup", name: "查询记录", action: "lookup", scope: "fixture.read", protocol: "mcp-streamable-http", operationKind: "read", endpoint,
    headers: registration.headers, inputSchema: schema, outputSchema: { type: "object" },
  }]))[0];
  const invoke = () => invokeMcpTool({ tool, action: "lookup", idempotencyKey: "fixture-key", input: {}, outputs: {} });
  return { registration, messages, violations, invoke, deletes: () => deletes };
}

describe("连接检查与实际执行使用同一 MCP 协议语义（本机 SDK）", () => {
  it.each(["modern", "legacy-rpc", 400, 404, 405, 406, 415] as const)("只读发现及旧握手回退：%s", async (discovery) => {
    const server = await fixture({ discovery });
    const result = await checkMcpConnection(server.registration);
    expect(result.status).toBe("available");
    expect(server.messages[0].method).toBe("server/discover");
    expect(server.messages.some((message) => message.method === "tools/call")).toBe(false);
    expect(server.messages.every((message) => !message.key)).toBe(true);
    expect(server.messages.some((message) => message.method === "initialize")).toBe(discovery !== "modern");
    expect(server.messages.filter((message) => message.method === "tools/list").map((message) => message.version)).toEqual([discovery === "modern" ? "2026-07-28" : "2025-11-25"]);
    expect(server.deletes()).toBe(discovery === "modern" ? 0 : 1);
    expect(await server.invoke()).toEqual({ ok: true, output: { amount: 0, active: false } });
    expect(server.messages.filter((message) => message.method === "tools/call")).toHaveLength(1);
    expect(server.violations).toEqual([]);
  });

  it("未登记工具的合法远端名称及大定义不影响已登记工具，也不进入响应", async () => {
    const server = await fixture({ pages: [{ tools: [registered, { name: "_helper", inputSchema: { type: "object", description: "remote-private".repeat(6000) } }, { name: "-".repeat(128), inputSchema: schema }] }] });
    const result = await checkMcpConnection(server.registration);
    expect(result).toMatchObject({ status: "available", tools: [{ registryToolId: "lookup", name: "查询记录", status: "available" }] });
    expect(JSON.stringify(result)).not.toContain("remote-private");
    expect(JSON.stringify(result)).not.toContain("_helper");
    expect(server.messages.filter((message) => message.method === "tools/call")).toHaveLength(0);
    expect(await server.invoke()).toMatchObject({ ok: true });
  });

  it("完整读取五页各一百项，登记工具在最后一页仍可核对和执行", async () => {
    const pages = Array.from({ length: 5 }, (_, page) => ({
      tools: Array.from({ length: 100 }, (_, index) => page === 4 && index === 99 ? registered : { name: `_remote_${page}_${index}`, inputSchema: schema }),
      ...(page < 4 ? { nextCursor: String(page + 1) } : {}),
    }));
    const server = await fixture({ pages });
    expect((await checkMcpConnection(server.registration)).status).toBe("available");
    expect(server.messages.filter((message) => message.method === "tools/list")).toHaveLength(5);
    expect(server.messages.filter((message) => message.method === "tools/call")).toHaveLength(0);
    expect(await server.invoke()).toMatchObject({ ok: true });
  });

  it("多页总量可以超过一兆，单页仍小于一兆且不泄露远端内容", async () => {
    const server = await fixture({ pages: [
      { tools: [{ name: "_helper", inputSchema: schema, description: "x".repeat(600_000) }], nextCursor: "1" },
      { tools: [{ ...registered, description: "x".repeat(600_000) }] },
    ] });
    const result = await checkMcpConnection(server.registration);
    expect(result.status).toBe("available");
    expect(JSON.stringify(result).length).toBeLessThan(1000);
    expect(server.messages.filter((message) => message.method === "tools/call")).toHaveLength(0);
    expect(await server.invoke()).toMatchObject({ ok: true });
  });

  it("不请求第六页，也不使用不完整目录冒充检测成功或执行工具", async () => {
    const server = await fixture({ pages: Array.from({ length: 6 }, (_, page) => ({ tools: [page === 5 ? registered : { name: `_helper_${page}`, inputSchema: schema }], ...(page < 5 ? { nextCursor: String(page + 1) } : {}) })) });
    expect((await checkMcpConnection(server.registration)).status).toBe("protocol-error");
    expect(server.messages.filter((message) => message.method === "tools/list")).toHaveLength(5);
    expect(await server.invoke()).toMatchObject({ ok: false, retryable: false });
    expect(server.messages.filter((message) => message.method === "tools/list")).toHaveLength(10);
    expect(server.messages.filter((message) => message.method === "tools/call")).toHaveLength(0);
  });

  it("超过四兆总量或单页超过一百项不可用，检查永不调用工具", async () => {
    for (const pages of [
      Array.from({ length: 5 }, (_, page) => ({ tools: [{ name: `_helper_${page}`, inputSchema: schema, description: "x".repeat(900_000) }], ...(page < 4 ? { nextCursor: String(page + 1) } : {}) })),
      [{ tools: Array.from({ length: 101 }, (_, index) => ({ name: `_helper_${index}`, inputSchema: schema })) }],
    ]) {
      const server = await fixture({ pages });
      expect((await checkMcpConnection(server.registration)).status).toBe("protocol-error");
      expect(server.messages.filter((message) => message.method === "tools/call")).toHaveLength(0);
      expect(server.violations).toEqual([]);
    }
  });
});
