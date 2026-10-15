import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpConnectionRegistration } from "@/contracts/mcp-connection";
import { MAX_MCP_RESPONSE_BYTES } from "@/contracts/mcp-tool";
import type { ToolRegistration } from "./tool-registry";

const state = vi.hoisted(() => ({ registry: [] as ToolRegistration[] }));
vi.mock("@/server/tools/tool-registry", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/tools/tool-registry")>();
  return { ...original, loadToolRegistrySnapshot: (): ReturnType<typeof original.loadToolRegistrySnapshot> => ({
    status: state.registry.length ? "configured" : "not-configured", registry: state.registry,
  }) };
});

import { parseToolRegistry } from "./tool-registry";
import { checkMcpConnection } from "./mcp-connection-check";
import { invokeMcpTool } from "./invoke-mcp-tool";
import { getMcpConnectionConfiguration, inspectMcpConnection } from "@/server/queries/mcp-connections";
import { POST } from "@/app/api/mcp/connections/check/route";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { state.registry = []; await Promise.all(cleanups.splice(0).map((close) => close())); });
const localOutput = (mode: string) => {
  if (mode === "text-undeclared") return { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false, description: "local-output-only:" };
  const schema = { type: "object", properties: { amount: { type: "number" } }, description: "local-output-only:" };
  if (mode === "large") schema.description += "x".repeat(128 * 1024);
  if (mode === "max-undeclared") schema.description += "x".repeat(MAX_MCP_RESPONSE_BYTES - new TextEncoder().encode(JSON.stringify(schema)).byteLength);
  return schema;
};

async function fixture(discovery: "modern" | "legacy-rpc", mode: string) {
  const outputSchema = localOutput(mode), messages: Array<{ method: string; body: string }> = [], violations: string[] = [];
  const advertised = mode === "undeclared" || mode === "max-undeclared" || mode === "text-undeclared" ? undefined
    : mode === "invalid" ? { type: "array" }
      : mode === "changed" ? { ...outputSchema, properties: { amount: { type: "string" } } }
        : { description: outputSchema.description, properties: outputSchema.properties, type: "object" };
  const server = createServer(async (request, response) => {
    if (request.url !== "/mcp?fixture=receipt" || request.headers.authorization !== "Bearer output-fixture-only" || request.headers.cookie) violations.push("target-or-credentials");
    if (request.method === "DELETE") { response.writeHead(204); response.end(); return; }
    if (request.method !== "POST") { response.writeHead(405); response.end(); return; }
    let body = "";
    for await (const chunk of request) body += chunk;
    const rpc = JSON.parse(body) as { id: number; method: string };
    messages.push({ method: rpc.method, body });
    if (body.includes("local-output-only:")) violations.push("local-definition-sent");
    if (rpc.method !== "tools/call" && request.headers["idempotency-key"]) violations.push("probe-business-key");
    const reply = (result: Record<string, unknown>) => {
      response.writeHead(200, { "content-type": "application/json", ...(discovery === "legacy-rpc" ? { "mcp-session-id": "receipt-session" } : {}) });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { ...result, ...(discovery === "modern" ? { resultType: "complete" } : {}) } }));
    };
    if (rpc.method === "server/discover") {
      if (discovery === "modern") reply({ supportedVersions: ["2026-07-28"], capabilities: { tools: {} } });
      else { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: "unsupported" } })); }
    } else if (rpc.method === "initialize") {
      if (discovery === "modern") { violations.push("modern-initialize"); response.writeHead(400); response.end(); }
      else reply({ protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "receipt-fixture", version: "1" } });
    } else if (rpc.method === "notifications/initialized") { response.writeHead(202); response.end(); }
    else if (rpc.method === "tools/list") reply({ tools: [{ name: "lookup", description: "untrusted-remote-description", inputSchema: { type: "object" }, ...(advertised === undefined ? {} : { outputSchema: advertised }) }] });
    else if (rpc.method === "tools/call") {
      if (request.headers["idempotency-key"] !== "fixture-operation") violations.push("business-key");
      reply(mode === "text-undeclared" ? { content: [{ type: "text", text: "查询原文" }] } : { content: [], structuredContent: { amount: 0 } });
    } else { violations.push("unexpected-method"); response.writeHead(400); response.end(); }
  });
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("本机测试端口无效");
  const endpoint = `http://127.0.0.1:${address.port}/mcp?fixture=receipt`;
  state.registry = parseToolRegistry(JSON.stringify([{
    id: "lookup", name: "查询记录", action: "lookup", scope: "fixture.read", risk: "low", protocol: "mcp-streamable-http", operationKind: "read", endpoint,
    headers: { Authorization: "Bearer output-fixture-only" }, inputSchema: { type: "object" }, outputSchema,
  }]));
  expect(state.registry).toHaveLength(1);
  return { tool: state.registry[0], messages, violations, outputSchema, endpoint };
}

describe("实际查询及HTTP契约的回执定义诊断（真实SDK、本机假服务，登记载入内存替身）", () => {
  it.each((["modern", "legacy-rpc"] as const).flatMap((discovery) => ["match", "changed", "undeclared", "text-undeclared", "invalid", "large", "max-undeclared"].map((mode) => ({ discovery, mode }))))("$discovery / $mode 检测与执行一致，诊断永不调用业务工具", async ({ discovery, mode }) => {
    const server = await fixture(discovery, mode), available = mode !== "changed" && mode !== "invalid";
    expect(getMcpConnectionConfiguration().status).toBe("configured");
    const checked = await inspectMcpConnection("lookup");
    expect(checked.status).toBe(available ? "available" : "definition-changed");
    const response = await POST(new Request("https://studio.example/api/mcp/connections/check", { method: "POST", headers: { origin: "https://studio.example", "content-type": "application/json" }, body: JSON.stringify({ connectionId: "lookup" }) }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const view = await response.json();
    expect(view.status).toBe(checked.status);
    expect(JSON.stringify([checked, view])).not.toMatch(/output-fixture-only|local-output-only|untrusted-remote-description|outputSchema|executionOutputDefinitions/);
    expect(JSON.stringify(view)).not.toContain(server.endpoint);
    expect(server.messages.some((message) => message.method === "tools/call")).toBe(false);
    const count = server.messages.length;
    const rejected = await POST(new Request("https://studio.example/api/mcp/connections/check", { method: "POST", headers: { origin: "https://studio.example", "content-type": "application/json" }, body: JSON.stringify({ connectionId: "lookup", executionOutputDefinitions: {} }) }));
    expect(rejected.status).toBe(400);
    expect((await inspectMcpConnection("lookup", "other-workspace")).status).toBe("not-found");
    expect(server.messages).toHaveLength(count);
    const called = await invokeMcpTool({ tool: server.tool, idempotencyKey: "fixture-operation", action: "lookup", input: {}, outputs: {} });
    expect(called).toMatchObject(available ? { ok: true, output: mode === "text-undeclared" ? { text: "查询原文" } : { amount: 0 } } : { ok: false, retryable: false });
    expect(server.messages.filter((message) => message.method === "tools/call")).toHaveLength(available ? 1 : 0);
    expect(server.violations).toEqual([]);
    if (mode === "max-undeclared") expect(new TextEncoder().encode(JSON.stringify(server.outputSchema)).byteLength).toBe(MAX_MCP_RESPONSE_BYTES);
    if (mode === "large") expect(new TextEncoder().encode(JSON.stringify(server.outputSchema)).byteLength).toBeGreaterThan(64 * 1024);
  });

  it.each(["foreign", "invalid", "oversized"])("直接检查也在握手前拒绝 %s 执行期待定义", async (mode) => {
    const registration = McpConnectionRegistration.parse({ id: "fixture", name: "查询服务", workspaceId: "00000000-0000-4000-8000-000000000001", endpoint: "https://fixture.example/mcp", tools: [{ registryToolId: "lookup", name: "查询记录", action: "lookup", inputSchema: { type: "object" } }] });
    const schema = mode === "invalid" ? { type: "string" } : mode === "oversized" ? { type: "object", description: "x".repeat(MAX_MCP_RESPONSE_BYTES) } : { type: "object" };
    const fetchImpl = vi.fn(async () => { throw new Error("不允许网络调用"); });
    const result = await checkMcpConnection(registration, fetchImpl, new Map([[mode === "foreign" ? "other" : "lookup", schema]]));
    expect(result).toEqual({ status: "configuration-error", message: "连接配置无效，请管理员检查", tools: [] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
