import { describe, expect, it } from "vitest";
import { McpConnectionRegistration, McpConnectionId } from "@/contracts/mcp-connection";
import { ToolRegistryOption } from "@/contracts/tool-registry";
import { ToolOperationPayload } from "@/contracts/tool-operation";
import { parseToolRegistry } from "@/server/tools/tool-registry";
const base = { id: "registered-tool", name: "登记工具", action: "record", scope: "business", protocol: "mcp-streamable-http", operationKind: "read", endpoint: "http://127.0.0.1:9000/mcp", inputSchema: { type: "object" } };
const remoteNames = ["_helper", "a".repeat(101), "a".repeat(128)];
describe("远端已登记名称与内部标识分离", () => {
  it.each(remoteNames)("读工具登记和连接允许完整远端名称 %s", (action) => {
    expect(parseToolRegistry(JSON.stringify([{ ...base, action }]))).toHaveLength(1);
    expect(McpConnectionRegistration.safeParse({ id: base.id, name: base.name, endpoint: base.endpoint, workspaceId: "00000000-0000-4000-8000-000000000001", tools: [{ registryToolId: base.id, name: base.name, action, inputSchema: base.inputSchema }] }).success).toBe(true);
  });
  it.each(remoteNames)("写工具登记和载荷保留完整远端名称 %s", (action) => {
    const tool = { ...base, action, operationKind: "action", businessIdempotency: true, businessIdempotencyRetentionMs: 600000 };
    expect(parseToolRegistry(JSON.stringify([tool]))).toHaveLength(1);
    expect(ToolOperationPayload.safeParse({ action, input: { amount: 0, approved: false }, outputs: {} }).success).toBe(true);
  });
  it.each(["a".repeat(129), "bad/name", "bad name", "工具"])("拒绝非法或超界远端名称 %s", (action) => {
    expect(ToolRegistryOption.safeParse({ ...base, action }).success).toBe(false);
    expect(parseToolRegistry(JSON.stringify([{ ...base, action }]))).toEqual([]);
  });
  it.each([undefined, "http-json"])("HTTP或未填协议保留100字符边界 %s", (protocol) => {
    expect(ToolRegistryOption.safeParse({ ...base, protocol, action: "a".repeat(100) }).success).toBe(true);
    expect(ToolRegistryOption.safeParse({ ...base, protocol, action: "a".repeat(101) }).success).toBe(false);
    expect(parseToolRegistry(JSON.stringify([{ ...base, protocol, action: "a".repeat(101) }]))).toEqual([]);
  });
  it.each(["_internal", "a".repeat(101), "bad/id"])("内部id/连接id不扩大 %s", (id) => {
    expect(ToolRegistryOption.safeParse({ ...base, id }).success).toBe(false);
    expect(McpConnectionId.safeParse(id).success).toBe(false);
  });
  it("内部scope仍保留100字符边界", () => {
    expect(ToolRegistryOption.safeParse({ ...base, scope: "a".repeat(101) }).success).toBe(false);
  });
  it("普通旧登记默认字段与序列化完全不变，安全扩展仍可解析", () => {
    const tool = { id: "crm.update", name: "客户系统", action: "update_customer", scope: "customer.write", endpoint: "https://tools.example.com/update" };
    const result = parseToolRegistry(JSON.stringify([tool]));
    expect(JSON.stringify(result)).toBe('[{"id":"crm.update","name":"客户系统","description":"","action":"update_customer","scope":"customer.write","risk":"high","inputSchema":{"type":"object"},"outputSchema":{"type":"object"},"endpoint":"https://tools.example.com/update","method":"POST","headers":{}}]');
  });
});
