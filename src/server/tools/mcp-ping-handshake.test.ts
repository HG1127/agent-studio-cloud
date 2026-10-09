import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { McpConnectionRegistration, McpPingResponse } from "@/contracts/mcp-connection";
import { MAX_MCP_TRANSPORT_REQUESTS } from "@/contracts/mcp-tool";
import { checkMcpConnection } from "./mcp-connection-check";
import { invokeMcpTool } from "./invoke-mcp-tool";
import { parseToolRegistry } from "./tool-registry";

const schema = { type: "object", additionalProperties: false };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map((close) => close())); });

async function fixture(pages = 1, serverMethod = "ping", pingsPerPage = 1) {
  const requests: Array<{ method: string; key: string | undefined }> = [];
  const replies: Array<Record<string, unknown>> = [];
  const violations: string[] = [];
  const transportMethods: string[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const pending = new Map<string, () => void>();
  let sequence = 0;
  const server = createServer(async (request, response) => {
    transportMethods.push(request.method ?? "unknown");
    if (request.url !== "/mcp?session=fixture" || request.headers.authorization !== "Bearer local-only") violations.push("target-or-credentials");
    if (request.headers.cookie) violations.push("cookie");
    if (request.method === "DELETE") { response.writeHead(204); response.end(); return; }
    if (request.method !== "POST") { response.writeHead(405); response.end(); return; }
    let body = "";
    for await (const chunk of request) body += chunk;
    const rpc = JSON.parse(body) as { id: string | number; method?: string; result?: Record<string, unknown>; params?: { cursor?: string } };
    requests.push({ method: rpc.method ?? "response", key: request.headers["idempotency-key"] as string | undefined });
    if (rpc.method === undefined) {
      replies.push(rpc);
      const acknowledge = pending.get(String(rpc.id));
      if (!acknowledge || !rpc.result || Object.keys(rpc.result).length) violations.push("unexpected-response");
      response.writeHead(202); response.end(); acknowledge?.(); return;
    }
    const reply = (result: unknown) => {
      response.writeHead(200, { "content-type": "application/json", "mcp-session-id": "fixture-session" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
    };
    if (rpc.method === "server/discover") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "legacy-only" } }));
    } else if (rpc.method === "initialize") reply({ protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "local-heartbeat", version: "1" } });
    else if (rpc.method === "notifications/initialized") { response.writeHead(202); response.end(); }
    else if (rpc.method === "tools/list") {
      const page = Number(rpc.params?.cursor ?? 0);
      const ids = Array.from({ length: pingsPerPage }, () => `server-heartbeat-${++sequence}`);
      let remaining = ids.length;
      response.writeHead(200, { "content-type": "text/event-stream", "mcp-session-id": "fixture-session" });
      const event = (value: unknown) => response.write(`event: message\ndata: ${JSON.stringify(value)}\n\n`);
      const timer = setTimeout(() => {
        for (const id of ids) pending.delete(id);
        timers.delete(timer);
        if (response.writableEnded || response.destroyed) return;
        event({ jsonrpc: "2.0", id: rpc.id, error: { code: -32001, message: "missing-heartbeat-response" } }); response.end();
      }, 1000);
      timers.add(timer);
      for (const id of ids) pending.set(id, () => {
        pending.delete(id);
        if (--remaining || response.writableEnded || response.destroyed) return;
        clearTimeout(timer); timers.delete(timer);
        event({ jsonrpc: "2.0", id: rpc.id, result: { tools: page === pages - 1 ? [{ name: "lookup", inputSchema: schema }] : [], ...(page < pages - 1 ? { nextCursor: String(page + 1) } : {}) } });
        response.end();
      });
      for (const id of ids) event({ jsonrpc: "2.0", id, method: serverMethod });
    } else if (rpc.method === "tools/call") reply({ content: [], structuredContent: { amount: 0, active: false } });
    else { violations.push("unexpected-method"); response.writeHead(400); response.end(); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  cleanups.push(async () => {
    for (const timer of timers) clearTimeout(timer);
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("本机心跳服务端口无效");
  const registration = McpConnectionRegistration.parse({ id: "lookup", name: "查询记录", workspaceId: "00000000-0000-4000-8000-000000000001",
    endpoint: `http://127.0.0.1:${address.port}/mcp?session=fixture`, headers: { Authorization: "Bearer local-only", "Idempotency-Key": "must-not-send-to-heartbeat" },
    tools: [{ registryToolId: "lookup", name: "查询记录", action: "lookup", inputSchema: schema }],
  });
  const tool = parseToolRegistry(JSON.stringify([{ id: "lookup", name: "查询记录", action: "lookup", scope: "fixture.read", protocol: "mcp-streamable-http", operationKind: "read",
    endpoint: registration.endpoint, headers: registration.headers, inputSchema: schema, outputSchema: { type: "object" },
  }]))[0];
  return { registration, requests, replies, violations, transportMethods,
    invoke: () => invokeMcpTool({ tool, action: "lookup", idempotencyKey: "explicit-read-key", input: {}, outputs: {} }),
  };
}

describe("只读 MCP 检查的服务端心跳（本机真实 SDK）", () => {
  it.each([1, 5])("每页心跳得到严格空回复，读取 %i 页仍不调用业务工具", async (pages) => {
    const server = await fixture(pages);
    expect(await server.invoke(), JSON.stringify({ transport: server.transportMethods, rpc: server.requests.map((request) => request.method) })).toEqual({ ok: true, output: { amount: 0, active: false } });
    server.requests.splice(0); server.replies.splice(0);
    expect((await checkMcpConnection(server.registration)).status).toBe("available");
    expect(server.requests.filter((request) => request.method === "tools/list")).toHaveLength(pages);
    expect(server.requests.filter((request) => request.method === "tools/call")).toHaveLength(0);
    expect(server.requests.every((request) => request.key === undefined)).toBe(true);
    expect(server.replies).toHaveLength(pages);
    expect(server.replies.every((reply) => Object.keys(reply).sort().join(",") === "id,jsonrpc,result" && JSON.stringify(reply.result) === "{}")).toBe(true);
    expect(server.violations).toEqual([]);
  });

  it.each(["sampling/createMessage", "tools/call"])("不因为支持心跳而开放服务端发来的 %s", async (method) => {
    const server = await fixture(1, method);
    expect((await checkMcpConnection(server.registration)).status).not.toBe("available");
    expect(server.replies).toHaveLength(0);
    expect(server.requests.filter((request) => request.method === "tools/call")).toHaveLength(0);
  });

  it.each([false, true])("过量心跳仍有传输总量限制且不调用业务工具：执行模式 %s", async (execute) => {
    const server = await fixture(1, "ping", MAX_MCP_TRANSPORT_REQUESTS + 1);
    if (execute) expect(await server.invoke()).toMatchObject({ ok: false, retryable: false });
    else expect((await checkMcpConnection(server.registration)).status).not.toBe("available");
    expect(server.replies.length).toBeLessThan(MAX_MCP_TRANSPORT_REQUESTS);
    expect(server.requests.filter((request) => request.method === "tools/call")).toHaveLength(0);
    expect(server.transportMethods.length).toBeLessThanOrEqual(MAX_MCP_TRANSPORT_REQUESTS + (execute ? 0 : 1));
  });
});

describe("心跳回复不能承载额外参数或业务方法", () => {
  it.each(["123", 123, ""])("允许 SDK 的严格空回复编号 %j", (id) => {
    expect(McpPingResponse.safeParse({ jsonrpc: "2.0", id, result: {} }).success).toBe(true);
  });
  it.each([
    { jsonrpc: "2.0", id: 1, result: { secret: "not-a-heartbeat" } },
    { jsonrpc: "2.0", id: 1, result: {}, method: "tools/call" },
    { jsonrpc: "2.0", id: 1, result: {}, params: { name: "write" } },
    { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "unsupported" } },
    { jsonrpc: "2.0", id: null, result: {} },
    { jsonrpc: "2.0", id: 1, result: [] },
    { id: 1, result: {} },
  ])("拒绝不是严格空心跳回复的结构 %j", (value) => {
    expect(McpPingResponse.safeParse(value).success).toBe(false);
  });
});
