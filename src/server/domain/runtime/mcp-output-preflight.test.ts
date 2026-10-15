import { describe, expect, it, vi } from "vitest";
import { MAX_MCP_RESPONSE_BYTES } from "@/contracts/mcp-tool";
import { mcpToolLocalOutputDefinitionIssue, mcpToolOutputDefinitionIssue, normalizeMcpToolResult } from "./mcp-tool";

describe("本地 MCP 回执定义预检", () => {
  it.each([
    { schema: {} },
    { schema: { type: "object" } },
    { schema: { type: ["object", "null"], properties: { amount: { type: "number" }, active: { type: "boolean" } } } },
    { schema: { allOf: [{ type: "object" }, { required: ["amount"] }] } },
    { schema: { $ref: "#/$defs/Receipt", $defs: { Receipt: { type: "object", required: ["amount"] } } } },
  ])("保留既有可验证对象规则及旧服务不声明定义的兼容路径 %#", ({ schema }) => {
    const before = JSON.stringify(schema);
    expect(mcpToolLocalOutputDefinitionIssue(schema)).toBeNull();
    expect(mcpToolOutputDefinitionIssue(undefined, schema)).toBeNull();
    expect(normalizeMcpToolResult({ structuredContent: { amount: 0, active: false } }, schema))
      .toEqual({ ok: true, output: { amount: 0, active: false } });
    expect(JSON.stringify(schema)).toBe(before);
  });

  it.each([
    { schema: null }, { schema: [] }, { schema: true },
    { schema: { type: "string" } }, { schema: { type: ["number", "null"] } },
    { schema: { type: "object", properties: [] } },
    { schema: { type: "object", required: "amount" } },
    { schema: { type: "object", $ref: "https://remote.invalid/receipt" } },
    { schema: { type: "object", $ref: "#/$defs/Missing" } },
    { schema: { type: "object", anyOf: [] } },
    { schema: { type: "object", format: "not-supported" } },
  ])("损坏、无法返回对象或不支持的规则不能因远端省略定义而放行 %#", ({ schema }) => {
    expect(mcpToolLocalOutputDefinitionIssue(schema)).toBe("工具回执定义无效或超过容量，请检查服务端配置");
    expect(mcpToolOutputDefinitionIssue(undefined, schema as Record<string, unknown>)).not.toBeNull();
  });

  it("一兆字节边界和超过参数定义容量的合法回执规则不被缩窄", () => {
    const schema = { type: "object", description: "" };
    schema.description = "x".repeat(MAX_MCP_RESPONSE_BYTES - new TextEncoder().encode(JSON.stringify(schema)).byteLength);
    expect(new TextEncoder().encode(JSON.stringify(schema)).byteLength).toBe(MAX_MCP_RESPONSE_BYTES);
    expect(mcpToolLocalOutputDefinitionIssue(schema)).toBeNull();
    expect(mcpToolOutputDefinitionIssue(undefined, schema)).toBeNull();
    expect(mcpToolLocalOutputDefinitionIssue({ ...schema, description: `${schema.description}x` })).not.toBeNull();
    expect(mcpToolLocalOutputDefinitionIssue({ type: "object", description: "汉".repeat(12_000) })).toBeNull();
  });

  it("使用序列化后的 UTF8 字节容量，而不是文字长度", () => {
    for (const description of ["汉".repeat(400_000), "\n".repeat(600_000)]) {
      expect(description.length).toBeLessThan(MAX_MCP_RESPONSE_BYTES);
      expect(mcpToolLocalOutputDefinitionIssue({ type: "object", description })).not.toBeNull();
    }
  });

  it("访问器、序列化钩子及循环在读取前拒绝", () => {
    const getter = vi.fn(() => "object"), toJSON = vi.fn(() => ({ type: "object" }));
    const cyclic: Record<string, unknown> = { type: "object" }; cyclic.properties = cyclic;
    for (const schema of [{ get type() { return getter(); } }, { type: "object", toJSON }, cyclic]) {
      expect(mcpToolLocalOutputDefinitionIssue(schema)).not.toBeNull();
      expect(mcpToolOutputDefinitionIssue(undefined, schema)).not.toBeNull();
      expect(normalizeMcpToolResult({ structuredContent: {} }, schema)).toMatchObject({ ok: false, retryable: false });
    }
    expect(getter).not.toHaveBeenCalled(); expect(toJSON).not.toHaveBeenCalled();
  });
});
