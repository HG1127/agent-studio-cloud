import { describe, expect, it, vi } from "vitest";
import { McpConnectionRegistration } from "@/contracts/mcp-connection";
import { WorkflowNode } from "@/contracts/workflow";
import { compareMcpDirectory } from "@/server/domain/mcp-connection";
import { mcpToolDefinitionIssue, mcpToolOutputDefinitionIssue, normalizeMcpToolResult } from "@/server/domain/runtime/mcp-tool";
import { parseToolRegistry } from "@/server/tools/tool-registry";
import { toolRegistrationCompatibilityIssue } from "@/server/tools/tool-binding";
import { toolDefinitionsEqual } from "@/server/domain/tool-definition-equality";

const pairs = [["\u00e9", "e\u0301"], ["\u00c5", "A\u030a"], ["\u00f1", "n\u0303"], ["\uac00", "\u1100\u1161"], ["\u1e0b", "d\u0307"]];
const definition = (first: string, second: string, reversed = false) => ({ type: "object", required: [first, second], additionalProperties: false,
  properties: Object.fromEntries((reversed ? [[second, { type: "number" }], [first, { type: "string" }]] : [[first, { type: "string" }], [second, { type: "number" }]])),
});
const registration = (inputSchema: Record<string, unknown>, outputSchema = inputSchema) => parseToolRegistry(JSON.stringify([{
  id: "lookup", name: "查询资料", action: "lookup", scope: "fixture.read", risk: "low", protocol: "mcp-streamable-http", operationKind: "read",
  endpoint: "https://fixture.example/mcp", inputSchema, outputSchema,
}]))[0];
const snapshot = (tool: ReturnType<typeof registration>, inputSchema: Record<string, unknown>, outputSchema = inputSchema) => WorkflowNode.parse({
  id: "lookup", title: "查询资料", type: "tool", tool: { ...tool, connector: "查询服务", registryToolId: tool.id, inputSchema, outputSchema },
}).tool!;
const connection = (inputSchema: Record<string, unknown>, outputSchema = inputSchema) => McpConnectionRegistration.parse({
  id: "fixture", name: "查询服务", workspaceId: "00000000-0000-4000-8000-000000000001", endpoint: "https://fixture.example/mcp",
  tools: [{ registryToolId: "lookup", name: "查询资料", action: "lookup", inputSchema, outputSchema }],
});

describe("工具定义的对象键顺序不是业务漂移", () => {
  it.each(pairs)("宿主排序权重相同但不同的业务键 %s / %s 不因重排阻断登记、连接或运行", (first, second) => {
    expect(first).not.toBe(second);
    expect(first.localeCompare(second)).toBe(0);
    const expected = definition(first, second), actual = definition(first, second, true), before = JSON.stringify([expected, actual]);
    const tool = registration(expected), frozen = snapshot(tool, actual);
    expect(toolRegistrationCompatibilityIssue(frozen, tool)).toBeNull();
    expect(toolRegistrationCompatibilityIssue({ ...frozen, protocol: "http-json" }, { ...tool, protocol: "http-json" })).toBeNull();
    expect(mcpToolDefinitionIssue(actual, expected)).toBeNull();
    expect(mcpToolOutputDefinitionIssue(actual, expected)).toBeNull();
    expect(compareMcpDirectory(connection(expected), [{ name: "lookup", inputSchema: actual, outputSchema: actual }]).status).toBe("available");
    const result = { [first]: "原文", [second]: 0 };
    expect(normalizeMcpToolResult({ structuredContent: result }, expected)).toEqual({ ok: true, output: result });
    expect(Object.keys(tool.inputSchema.properties as object)).toEqual([first, second]);
    expect(JSON.stringify([expected, actual])).toBe(before);
  });

  it.each(pairs)("两个实际业务键 %s / %s 不做 Unicode 归一化、合并或类型互换", (first, second) => {
    const expected = definition(first, second), actual = definition(second, first);
    const tool = registration(expected), frozen = snapshot(tool, expected);
    expect(mcpToolDefinitionIssue(actual, expected)).not.toBeNull();
    expect(mcpToolOutputDefinitionIssue(actual, expected)).not.toBeNull();
    for (const protocol of ["http-json", "mcp-streamable-http"] as const) {
      expect(toolRegistrationCompatibilityIssue({ ...frozen, protocol }, { ...tool, protocol, inputSchema: actual })).not.toBeNull();
      expect(toolRegistrationCompatibilityIssue({ ...frozen, protocol }, { ...tool, protocol, outputSchema: actual })).not.toBeNull();
    }
    expect(compareMcpDirectory(connection(expected), [{ name: "lookup", inputSchema: expected, outputSchema: actual }]).status).toBe("definition-changed");
    expect(normalizeMcpToolResult({ structuredContent: { [first]: 0, [second]: "原文" } }, expected).ok).toBe(false);
    expect(mcpToolDefinitionIssue({ ...expected, properties: { [first]: { type: "string" } } }, expected)).not.toBeNull();
  });

  it.each(["required", "enum", "examples"])("仅忽略对象键顺序，不顺带放宽 %s 数组的冻结顺序", (keyword) => {
    const expected = { type: "object", [keyword]: keyword === "required" ? ["one", "two"] : [{ one: 0 }, { one: 1 }] };
    const actual = { ...expected, [keyword]: [...expected[keyword] as unknown[]].reverse() };
    expect(mcpToolDefinitionIssue(actual, expected)).not.toBeNull();
    expect(mcpToolOutputDefinitionIssue(actual, expected)).not.toBeNull();
  });

  it("三个边界不借助宿主排序决定任意业务字段相等", () => {
    const tool = registration(definition("顾客", "金额")), frozen = snapshot(tool, definition("顾客", "金额", true));
    const locale = vi.spyOn(String.prototype, "localeCompare").mockReturnValue(0);
    try {
      expect(toolRegistrationCompatibilityIssue(frozen, tool)).toBeNull();
      expect(mcpToolDefinitionIssue(frozen.inputSchema, tool.inputSchema)).toBeNull();
      expect(mcpToolOutputDefinitionIssue(frozen.outputSchema, tool.outputSchema)).toBeNull();
      expect(compareMcpDirectory(connection(tool.inputSchema, tool.outputSchema), [{ name: "lookup", inputSchema: frozen.inputSchema, outputSchema: frozen.outputSchema }]).status).toBe("available");
      expect(locale).not.toHaveBeenCalled();
    } finally { locale.mockRestore(); }
  });

  it("HTTP 绑定保留旧 JSON 省略可选未定义字段和正负零相同的语义", () => {
    const tool = registration({ type: "object", properties: { amount: { type: "number", default: 0 } } });
    const frozen = snapshot(tool, { type: "object", properties: { amount: { type: "number", default: -0, description: undefined } } });
    expect(toolRegistrationCompatibilityIssue({ ...frozen, protocol: "http-json" }, { ...tool, protocol: "http-json" })).toBeNull();
  });

  it.each(["examples", "default", "enum"])("%s 空槽不能跳过真实值，也不改变旧 JSON 空值表示", (keyword) => {
    const holes = Array<unknown>(1), sparse = { type: "object", [keyword]: holes };
    const changed = { type: "object", [keyword]: ["changed"] };
    const empty = { type: "object", [keyword]: [null] };
    expect(mcpToolOutputDefinitionIssue(changed, changed)).toBeNull();
    expect(mcpToolOutputDefinitionIssue(empty, empty)).toBeNull();
    expect(toolDefinitionsEqual(sparse, changed)).toBe(false);
    expect(mcpToolOutputDefinitionIssue(sparse, changed)).not.toBeNull();
    expect(toolDefinitionsEqual(sparse, empty)).toBe(true);
    expect(0 in holes).toBe(false);
  });
});
