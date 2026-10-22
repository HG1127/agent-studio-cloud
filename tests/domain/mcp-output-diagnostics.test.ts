import { describe, expect, it, vi } from "vitest";
import { McpConnectionRegistration } from "@/contracts/mcp-connection";
import { MAX_MCP_RESPONSE_BYTES } from "@/contracts/mcp-tool";
import { compareMcpDirectory, mcpExecutionOutputDefinitionsAreValid } from "@/server/domain/mcp-connection";
import { mcpToolOutputDefinitionIssue } from "@/server/domain/runtime/mcp-tool";

const registration = McpConnectionRegistration.parse({ id: "service", name: "查询服务", workspaceId: "00000000-0000-4000-8000-000000000001", endpoint: "https://fixture.example/mcp",
  tools: [{ registryToolId: "lookup", name: "查询记录", action: "lookup", inputSchema: { type: "object" } }],
});
const output = { type: "object", properties: { amount: { type: "number" } } };
const definitions = new Map([["lookup", output]]);
const directory = (outputSchema?: Record<string, unknown>) => [{ name: "lookup", inputSchema: { type: "object" }, ...(outputSchema === undefined ? {} : { outputSchema }) }];
const explicit = { ...registration, tools: [{ ...registration.tools[0], outputSchema: output }] };
type McpExecutionOutputDefinitions = NonNullable<Parameters<typeof compareMcpDirectory>[2]>;

describe("实际执行登记的回执定义参与连接检测", () => {
  it.each([output, { properties: output.properties, type: "object" }, undefined])("同运行规则接收相同、重排或旧服务未公布定义 %#", (actual) => {
    const before = JSON.stringify([registration, actual, [...definitions]]);
    expect(mcpExecutionOutputDefinitionsAreValid(registration, definitions)).toBe(true);
    expect(mcpToolOutputDefinitionIssue(actual, output)).toBeNull();
    expect(compareMcpDirectory(registration, directory(actual), definitions)).toEqual({ status: "available", message: "连接及已登记工具的定义检查通过",
      tools: [{ registryToolId: "lookup", name: "查询记录", status: "available" }],
    });
    expect(JSON.stringify([registration, actual, [...definitions]])).toBe(before);
  });

  it.each([
    { type: "object" }, { type: "object", properties: { amount: { type: "string" } } }, { type: "array" },
    { type: "object", $ref: "https://private.invalid/receipt" }, { ...output, additionalProperties: false }, { ...output, required: ["amount"] },
  ])("已公布的回执规则漂移或不可执行时，不再报连接可用 %#", (actual) => {
    expect(mcpToolOutputDefinitionIssue(actual, output)).not.toBeNull();
    const result = compareMcpDirectory(registration, directory(actual), definitions);
    expect(result).toMatchObject({ status: "definition-changed", tools: [{ registryToolId: "lookup", status: "definition-changed" }] });
    expect(JSON.stringify(result)).not.toMatch(/private.invalid|outputSchema|properties/);
  });

  it("独立执行映射不能降低旧显式登记对缺失远端定义的严格要求", () => {
    expect(compareMcpDirectory(explicit, directory()).status).toBe("definition-changed");
    expect(compareMcpDirectory(explicit, directory(), definitions).status).toBe("definition-changed");
    expect(compareMcpDirectory(explicit, directory(output), definitions).status).toBe("available");
  });

  it("没有执行期待定义的旧调用方式和空映射不被暗中改成强制回执", () => {
    expect(compareMcpDirectory(registration, directory({ type: "array" })).status).toBe("available");
    expect(compareMcpDirectory(registration, directory(), new Map()).status).toBe("available");
    expect(mcpExecutionOutputDefinitionsAreValid(registration)).toBe(true);
  });

  it("按登记标识而非远端名称或位置选择各自期待定义，不输出未登记数据", () => {
    const second = { type: "object", properties: { note: { type: "string" } } };
    const registered = { ...registration, tools: [...registration.tools, { registryToolId: "second-local", name: "另一查询", action: "other.remote", inputSchema: { type: "object" } }] };
    const expected = new Map<string, Record<string, unknown>>([["lookup", output], ["second-local", second]]);
    const result = compareMcpDirectory(registered, [...directory(output),
      { name: "other.remote", inputSchema: { type: "object" }, outputSchema: { type: "object", properties: { note: { type: "number" } } } },
      { name: "unregistered", inputSchema: { type: "object" }, outputSchema: { type: "object", description: "untrusted-remote-text" } },
    ], expected);
    expect(result.tools).toEqual([{ registryToolId: "lookup", name: "查询记录", status: "available" }, { registryToolId: "second-local", name: "另一查询", status: "definition-changed" }]);
    expect(JSON.stringify(result)).not.toMatch(/unregistered|untrusted-remote-text|outputSchema|properties/);
    expect(expected.size).toBe(2);
  });

  const invalid: Array<{ name: string; registration: McpConnectionRegistration; definitions: McpExecutionOutputDefinitions }> = [
    { name: "无归属标识", registration, definitions: new Map([["other.remote", output]]) },
    { name: "额外映射", registration, definitions: new Map([["lookup", output], ["unknown", output]]) },
    { name: "非对象回执", registration, definitions: new Map([["lookup", { type: "string" }]]) },
    { name: "错误属性定义", registration, definitions: new Map([["lookup", { type: "object", properties: [] }]]) },
    { name: "远程引用", registration, definitions: new Map([["lookup", { type: "object", $ref: "https://private.invalid/receipt" }]]) },
    { name: "超出一兆", registration, definitions: new Map([["lookup", { type: "object", description: "x".repeat(MAX_MCP_RESPONSE_BYTES) }]]) },
    { name: "稀疏示例", registration, definitions: new Map([["lookup", { type: "object", examples: Array<unknown>(1) }]]) },
    { name: "未定义值", registration, definitions: new Map([["lookup", undefined]]) as unknown as McpExecutionOutputDefinitions },
    { name: "与显式登记冲突", registration: explicit, definitions: new Map([["lookup", { type: "object" }]]) },
  ];
  it.each(invalid)("错误本地映射 $name 在读取目录前明确拒绝", ({ registration, definitions }) => {
    const getter = vi.fn(() => "lookup"), remote = [{ get name() { return getter(); }, inputSchema: { type: "object" } }];
    expect(mcpExecutionOutputDefinitionsAreValid(registration, definitions)).toBe(false);
    expect(compareMcpDirectory(registration, remote, definitions)).toEqual({ status: "configuration-error", message: "连接配置无效，请管理员检查", tools: [] });
    expect(getter).not.toHaveBeenCalled();
  });

  it("独立执行定义保留完整一兆字节，不扩大旧64KB登记契约或将正文放入结果", () => {
    const largest = { type: "object", description: "" };
    largest.description = "x".repeat(MAX_MCP_RESPONSE_BYTES - new TextEncoder().encode(JSON.stringify(largest)).byteLength);
    expect(new TextEncoder().encode(JSON.stringify(largest)).byteLength).toBe(MAX_MCP_RESPONSE_BYTES);
    expect(McpConnectionRegistration.safeParse({ ...registration, tools: [{ ...registration.tools[0], outputSchema: largest }] }).success).toBe(false);
    const map = new Map([["lookup", largest]]);
    expect(mcpExecutionOutputDefinitionsAreValid(registration, map)).toBe(true);
    const result = compareMcpDirectory(registration, directory(), map);
    expect(result.status).toBe("available");
    expect(JSON.stringify(result).length).toBeLessThan(400);
    expect(registration.tools[0]).not.toHaveProperty("outputSchema");
  });
});
