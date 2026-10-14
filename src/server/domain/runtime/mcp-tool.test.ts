import { describe, expect, it, vi } from "vitest";
import { mcpToolDefinitionIssue, mcpToolInputDefinitionIssue, normalizeMcpToolResult } from "./mcp-tool";
import { MAX_MCP_DEFINITION_BYTES } from "@/contracts/mcp-tool";

describe("已登记 MCP 参数定义纯预检", () => {
  it.each([{ type: "object" }, { type: "object", properties: {}, additionalProperties: false }, { type: "object", properties: { active: { type: "boolean", default: false }, amount: { type: "number", default: 0 } } }])("接受已支持对象和零参数定义 %#", (definition) => {
    expect(mcpToolInputDefinitionIssue(definition)).toBeNull();
  });
  it.each([null, [], {}, { type: "string" }, { type: ["object", "null"] }, { type: "object", properties: [] }, { type: "object", maxProperties: -1 }])("拒绝不符合执行规则的定义 %#", (definition) => {
    expect(mcpToolInputDefinitionIssue(definition)).toBe("工具参数定义无效或超过容量，请检查服务端配置");
  });
  it("按真实JSON和UTF8字节验证，边界值保留、不截断", () => {
    const definition = { type: "object", description: "" };
    definition.description = "x".repeat(MAX_MCP_DEFINITION_BYTES - new TextEncoder().encode(JSON.stringify(definition)).byteLength);
    expect(new TextEncoder().encode(JSON.stringify(definition)).byteLength).toBe(MAX_MCP_DEFINITION_BYTES);
    expect(mcpToolInputDefinitionIssue(definition)).toBeNull();
    expect(mcpToolInputDefinitionIssue({ ...definition, description: `${definition.description}x` })).not.toBeNull();
    expect(mcpToolInputDefinitionIssue({ type: "object", description: "汉".repeat(12_000) })).not.toBeNull();
    expect(definition.description.length).toBe(MAX_MCP_DEFINITION_BYTES - 34);
  });
  it("不执行访问器和序列化代码，也不接受循环定义", () => {
    const getter = vi.fn(() => "object"), toJSON = vi.fn(() => ({ type: "object" }));
    expect(mcpToolInputDefinitionIssue({ get type() { return getter(); } })).not.toBeNull();
    expect(mcpToolInputDefinitionIssue({ type: "object", toJSON })).not.toBeNull();
    const cyclic: Record<string, unknown> = { type: "object" }; cyclic.properties = cyclic;
    expect(mcpToolInputDefinitionIssue(cyclic)).not.toBeNull();
    expect(getter).not.toHaveBeenCalled(); expect(toJSON).not.toHaveBeenCalled();
  });
});

describe("MCP 回执与参数规则", () => {
  it("规则顺序无关，但新字段与语义改变不能静默接受", () => {
    expect(mcpToolDefinitionIssue({ required: ["id"], type: "object" }, { type: "object", required: ["id"] })).toBeNull();
    expect(mcpToolDefinitionIssue({ type: "object" }, { type: "object", required: ["id"] })).not.toBeNull();
  });
  it("参数定义按 UTF-8 字节和 JSON 实际长度限制，不按字符数冒充容量", () => {
    for (const description of ["汉".repeat(12_000), "x".repeat(32 * 1024 - 20)]) {
      const definition = { type: "object", description };
      expect(description.length).toBeLessThan(32 * 1024);
      expect(new TextEncoder().encode(JSON.stringify(definition)).byteLength).toBeGreaterThan(32 * 1024);
      expect(mcpToolDefinitionIssue(definition, definition)).not.toBeNull();
    }
    const definition = { type: "object", description: "汉".repeat(10_000) };
    expect(mcpToolDefinitionIssue(definition, definition)).toBeNull();
  });
  it.each([null, [], { content: [] }, { content: [{ type: "image", data: "secret" }] }, { content: [{ type: "text", text: "[]" }] }, { structuredContent: { ok: 1 }, content: [] }])("无效回执不放行 %j", (value) => {
    expect(normalizeMcpToolResult(value, { type: "object" })).toMatchObject({ ok: false, retryable: false });
  });
  it("错误标记优先于正确结构化内容且不回显远端错误", () => {
    expect(normalizeMcpToolResult({ isError: true, structuredContent: { ok: true }, content: [{ type: "text", text: "sk-secret" }] }, { type: "object" })).toEqual({ ok: false, retryable: false, error: "远端工具报告操作未完成" });
  });
  it("不执行访问器或序列化代码", () => {
    const getter = vi.fn(); const result = { get structuredContent() { getter(); return {}; } };
    expect(normalizeMcpToolResult(result, { type: "object" }).ok).toBe(false); expect(getter).not.toHaveBeenCalled();
  });
  it("保留结构化普通业务值并优先于文本", () => {
    expect(normalizeMcpToolResult({ structuredContent: { n: 0, flag: false }, content: [{ type: "text", text: "bad" }] }, { type: "object" })).toEqual({ ok: true, output: { n: 0, flag: false } });
  });
});
