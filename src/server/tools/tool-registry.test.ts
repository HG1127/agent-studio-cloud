import { afterEach, describe, expect, it, vi } from "vitest";
import { listToolCompilerCapabilities, listToolRegistryOptions, loadToolRegistry, loadToolRegistrySnapshot, parseToolRegistry } from "@/server/tools/tool-registry";
import { ToolRegistryOption } from "@/contracts/tool-registry";

const tool = {
  id: "crm.update",
  name: "客户系统",
  action: "update_customer",
  scope: "customer.write",
  endpoint: "https://tools.example.com/update",
};

describe("注册表配置快照", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it.each([undefined, "", "  ", "[]"])("缺失或合法空数组不误报无效配置 %s", (raw) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("TOOL_REGISTRY_JSON", raw);
    expect(loadToolRegistry()).toEqual([]);
    expect(error).not.toHaveBeenCalled();
    expect(loadToolRegistrySnapshot()).toEqual({ status: "not-configured", registry: [] });
  });

  it.each([
    "{", "null", "{}", JSON.stringify([tool, tool]), JSON.stringify([{ ...tool, headers: { Host: "bad.example" } }]),
    JSON.stringify([{ ...tool, protocol: "mcp-streamable-http" }]),
    JSON.stringify([{ ...tool, protocol: "mcp-streamable-http", operationKind: "read", method: "PUT" }]),
    JSON.stringify([{ ...tool, protocol: "mcp-streamable-http", operationKind: "action" }]),
    JSON.stringify([{ ...tool, businessIdempotency: true }]),
    JSON.stringify([{ ...tool, inputSchema: { type: "object", default: { apiKey: "private-fake-value" } } }]),
  ])("非法配置与合法空目录分开且不回显原文 %#", (raw) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("TOOL_REGISTRY_JSON", raw);
    expect(loadToolRegistrySnapshot()).toEqual({ status: "configuration-error", registry: [] });
    expect(error.mock.calls).toEqual([["[tool-registry] 工具注册表配置无效"]]);
    expect(loadToolRegistry()).toEqual([]);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("状态和私有登记来自同一次解析，配置变化不沿用旧状态", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify([tool]));
    const first = loadToolRegistrySnapshot();
    expect(first.status).toBe("configured");
    expect(loadToolRegistry()).toBe(first.registry);
    vi.stubEnv("TOOL_REGISTRY_JSON", "{");
    expect(loadToolRegistrySnapshot()).toEqual({ status: "configuration-error", registry: [] });
    vi.stubEnv("TOOL_REGISTRY_JSON", "[]");
    expect(loadToolRegistrySnapshot()).toEqual({ status: "not-configured", registry: [] });
    vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify([tool]));
    expect(loadToolRegistrySnapshot().registry).toEqual(first.registry);
  });
});

describe("业务工具注册表", () => {
  it("跨运行防重必须显式声明服务端保证的键有效期", () => {
    expect(parseToolRegistry(JSON.stringify([{ ...tool, businessIdempotency: true }]))).toEqual([]);
    expect(parseToolRegistry(JSON.stringify([{ ...tool, businessIdempotency: true, businessIdempotencyRetentionMs: 600_000 }])))
      .toEqual([expect.objectContaining({ businessIdempotencyRetentionMs: 600_000 })]);
    expect(parseToolRegistry(JSON.stringify([{ ...tool, businessIdempotency: true, businessIdempotencyRetentionMs: 1000 }]))).toEqual([]);
  });
  it.each(["inputSchema", "outputSchema"])("注册时保留 %s 中多处重复的格式规则，交由有界匹配校验", (field) => {
    const schema = { type: "object", properties: { code: { type: "string", pattern: "^a+a+a+a+a+a+b$", maxLength: 80 } } };
    expect(parseToolRegistry(JSON.stringify([{ ...tool, [field]: schema }])))
      .toEqual([expect.objectContaining({ [field]: schema })]);
  });

  it("仍注册包含固定前缀与单处可变重复的格式规则", () => {
    const schema = { type: "object", properties: { code: { type: "string", pattern: "^[A-Z]{2}[0-9]+$", maxLength: 80 } } };
    expect(parseToolRegistry(JSON.stringify([{ ...tool, inputSchema: schema, outputSchema: schema }])))
      .toEqual([expect.objectContaining({ inputSchema: schema, outputSchema: schema })]);
  });

  it("接收可供 HTTP 请求使用的凭据请求头", () => {
    expect(parseToolRegistry(JSON.stringify([{ ...tool, headers: { Authorization: "Bearer test" } }])))
      .toEqual([expect.objectContaining({ headers: { Authorization: "Bearer test" } })]);
  });

  it("注册时拒绝非法请求头，避免运行时抛错", () => {
    expect(parseToolRegistry(JSON.stringify([{ ...tool, headers: { "bad name": "value" } }]))).toEqual([]);
    expect(parseToolRegistry(JSON.stringify([{ ...tool, headers: { "X-Test": "bad\u0000value" } }]))).toEqual([]);
  });
});

describe("工具公开元数据的凭据边界", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("清理展示名称和说明，不把服务端请求头或文本凭据带到目录和编排能力", () => {
    const registration = { ...tool, name: "客户 Bearer abcdefghijklmnop", description: "联系 person@example.com；password=private-fake-password", headers: { Authorization: "Bearer server-only-test-value" } };
    vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify([registration]));
    for (const list of [listToolRegistryOptions(), listToolCompilerCapabilities()]) {
      expect(list).toHaveLength(1);
      const visible = JSON.stringify(list);
      expect(visible).not.toMatch(/abcdefghijklmnop|private-fake-password|server-only-test-value/);
      expect(visible).toContain("person@example.com");
      expect(visible).toContain("已隐藏敏感信息");
    }
    expect(parseToolRegistry(JSON.stringify([registration]))[0].headers).toEqual(registration.headers);
  });

  it.each([
    { type: "object", description: "Bearer abcdefghijklmnop" },
    { type: "object", examples: [{ apiKey: "private-fake-example" }] },
    { type: "object", default: { authorization: "private-fake-default" } },
    { type: "object", properties: { password: { type: "string", default: "private-fake-password" } } },
    { type: "object", properties: { apiKey: { type: "string", const: "private-fake-constant" } } },
    { type: "object", properties: { accessToken: { type: "string", enum: ["private-fake-enum"] } } },
  ])("包含凭据文字或固定凭据值的定义关闭登记，不能悄悄改写字段规则 %#", (schema) => {
    const original = JSON.stringify(schema);
    for (const field of ["inputSchema", "outputSchema"]) expect(parseToolRegistry(JSON.stringify([{ ...tool, [field]: schema }]))).toEqual([]);
    expect(JSON.stringify(schema)).toBe(original);
  });

  it("保留空凭据字段声明、正常用量、邮箱及零值否定值，不按字段名删除定义", () => {
    const schema = { type: "object", properties: { apiKey: { type: "string" }, email: { type: "string", const: "person@example.com" }, amount: { type: "number", default: 0 }, active: { type: "boolean", enum: [false] }, inputTokens: { type: "integer", examples: [0] } }, additionalProperties: false };
    const parsed = parseToolRegistry(JSON.stringify([{ ...tool, inputSchema: schema, outputSchema: schema }]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].inputSchema).toEqual(schema);
    expect(parsed[0].outputSchema).toEqual(schema);
  });
  it("清理后的展示文本仍满足原长度契约，操作标识和服务端请求头不变", () => {
    const registration = { ...tool, name: `${"甲".repeat(45)}password=abcdef`, description: `${"乙".repeat(185)}token=abcdef`, headers: { Authorization: "Bearer server-only-test-value" } };
    vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify([registration]));
    const options = listToolRegistryOptions();
    expect(options).toHaveLength(1);
    expect(ToolRegistryOption.safeParse(options[0]).success).toBe(true);
    expect(options[0].name.length).toBeLessThanOrEqual(60);
    expect(options[0].description.length).toBeLessThanOrEqual(200);
    expect(options[0].action).toBe(registration.action);
    expect(parseToolRegistry(JSON.stringify([registration]))[0].headers).toEqual(registration.headers);
    expect(JSON.stringify(options)).not.toContain("abcdef");
  });
});
