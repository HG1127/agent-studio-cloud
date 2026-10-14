import { describe, expect, it } from "vitest";
import { ToolRegistryOption } from "@/contracts/tool-registry";
import { McpToolUseFilter, filterMcpRegisteredTools, mcpToolUseAgentHref } from "./mcp-tool-use-guide";

const tool = ToolRegistryOption.parse({ id: "customer.lookup", name: "客户查询", description: "查找业务档案", action: "lookup", scope: "customer.read", risk: "low", protocol: "mcp-streamable-http", operationKind: "read" });
const write = ToolRegistryOption.parse({ ...tool, id: "customer.update", name: "更新客户", risk: "high", operationKind: "action" });
const undeclared = ToolRegistryOption.parse({ ...tool, id: "customer.unknown", name: "业务处理", risk: "medium", operationKind: undefined });
const http = ToolRegistryOption.parse({ ...tool, id: "http.lookup", protocol: "http-json" });
const all: McpToolUseFilter = { query: "", risk: "all", operation: "all" };

describe("远端登记工具使用筛选", () => {
  it("只读取真实远端登记，保持原顺序和定义引用，不推测连接或授权", () => {
    const source = [tool, http, write, undeclared];
    expect(filterMcpRegisteredTools(source, all)).toEqual([tool, write, undeclared]);
    expect(filterMcpRegisteredTools(source, all)[0]).toBe(tool);
    expect(source).toEqual([tool, http, write, undeclared]);
  });
  it.each(["客户", "档案", "  客户  "])("按业务名称或说明搜索：%s", (query) => {
    expect(filterMcpRegisteredTools([tool], { ...all, query })).toEqual([tool]);
  });
  it("不把内部编号、动作或范围变成面向用户的搜索词", () => {
    for (const query of [tool.id, tool.action, tool.scope]) expect(filterMcpRegisteredTools([tool], { ...all, query })).toEqual([]);
  });
  it.each(["low", "medium", "high"] as const)("按真实风险声明筛选：%s", (risk) => {
    expect(filterMcpRegisteredTools([tool, write, undeclared], { ...all, risk })).toEqual([tool, write, undeclared].filter((item) => item.risk === risk));
  });
  it.each(["read", "action", "undeclared"] as const)("读写未知不按名称或风险猜测：%s", (operation) => {
    const expected = operation === "read" ? tool : operation === "action" ? write : undeclared;
    expect(filterMcpRegisteredTools([tool, write, undeclared], { ...all, operation })).toEqual([expected]);
  });
  it("搜索、风险和读写声明共同生效，没有匹配不是连接失败", () => {
    expect(filterMcpRegisteredTools([tool, write], { query: "客户", risk: "high", operation: "read" })).toEqual([]);
    expect(filterMcpRegisteredTools([], all)).toEqual([]);
  });
  it("本地筛选结构只接受明确选项和最多200字搜索", () => {
    expect(McpToolUseFilter.safeParse({ ...all, query: "字".repeat(200) }).success).toBe(true);
    expect(McpToolUseFilter.safeParse({ ...all, query: "字".repeat(201) }).success).toBe(false);
    expect(McpToolUseFilter.safeParse({ ...all, risk: "available" }).success).toBe(false);
    expect(McpToolUseFilter.safeParse({ ...all, operation: "authorized" }).success).toBe(false);
    expect(McpToolUseFilter.safeParse({ ...all, endpoint: "https://private.invalid" }).success).toBe(false);
  });
});

describe("现有助手流程设计导航", () => {
  it("只生成共享契约允许的站内助手流程锚点，不构造绑定或授权请求", () => {
    expect(mcpToolUseAgentHref("00000000-0000-4000-8000-000000000001")).toBe("/agents/00000000-0000-4000-8000-000000000001#workflow");
  });
  it.each([undefined, null, "", "../settings", "https://external.invalid", "00000000-0000-4000-8000-000000000001?grant=true", {}])("无法核对的助手选择不生成导航：%s", (value) => {
    expect(mcpToolUseAgentHref(value)).toBeNull();
  });
});
