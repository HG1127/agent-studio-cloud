import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectMcpConnection, listMcpConnections } from "@/server/queries/mcp-connections";
import { parseToolRegistry } from "@/server/tools/tool-registry";
import { invokeRegisteredTool } from "@/server/tools/invoke-tool";
import { startRegisteredNameMcpServer } from "../../../tests/fixtures/mcp-registered-tool-name-server";
const servers: Array<Awaited<ReturnType<typeof startRegisteredNameMcpServer>>> = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(servers.splice(0).map((server) => server.close())); });
describe.each(["read", "action"])("真实本机SDK完整远端名称 %s", (operationKind) => {
  it.each(["_helper", "a".repeat(101), "a".repeat(128)])("连接检查与单独调用完整名称 %s", async (action) => {
    const server = await startRegisteredNameMcpServer(action); servers.push(server);
    const raw = JSON.stringify([{ id: "registered-tool", name: "已登记工具", action, scope: "business", risk: "low", protocol: "mcp-streamable-http", operationKind, endpoint: server.endpoint, inputSchema: server.inputSchema, outputSchema: { type: "object" }, ...(operationKind === "action" ? { businessIdempotency: true, businessIdempotencyRetentionMs: 600000 } : {}) }]);
    vi.stubEnv("TOOL_REGISTRY_JSON", raw);
    expect(listMcpConnections()).toEqual([{ id: "registered-tool", name: "已登记工具" }]);
    const checked = await inspectMcpConnection("registered-tool");
    expect(checked.status).toBe("available");
    expect(server.messages.some((message) => message.method === "tools/call")).toBe(false);
    const tool = parseToolRegistry(raw)[0];
    const invoked = await invokeRegisteredTool({ tool, action, idempotencyKey: "name-test-key", input: { amount: 0, approved: false }, outputs: {} });
    expect(invoked).toEqual({ ok: true, output: { receiptId: "test-receipt", amount: 0, approved: false } });
    expect(server.messages.filter((message) => message.method === "tools/call")).toEqual([{ method: "tools/call", params: { name: action, arguments: { amount: 0, approved: false } } }]);
  });
});
