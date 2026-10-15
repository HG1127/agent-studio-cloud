import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { McpConnectionConfigurationResult } from "@/contracts/mcp-connection";
import { MAX_MCP_RESPONSE_BYTES } from "@/contracts/mcp-tool";
const check = vi.hoisted(() => vi.fn());
vi.mock("@/server/tools/mcp-connection-check", () => ({ checkMcpConnection: check }));
import { getMcpConnectionConfiguration, inspectMcpConnection, listMcpConnections } from "./mcp-connections";
import * as registry from "@/server/tools/tool-registry";
import { invokeMcpTool } from "@/server/tools/invoke-mcp-tool";

const tool = { id: "lookup", name: "查询记录", action: "lookup", scope: "record.read", protocol: "mcp-streamable-http", operationKind: "read", endpoint: "https://private.example/mcp", headers: { Authorization: "Bearer private-fake-value" }, inputSchema: { type: "object" } };
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("TOOL_REGISTRY_JSON", "");
  check.mockImplementation(() => { throw new Error("配置诊断不允许访问网络"); });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("真实注册解析的配置诊断查询", () => {
  it("读写及弃用字段说明经真实登记与配置诊断保留，不推导工具性质", () => {
    const inputSchema = { type: "object", properties: { value: { type: "string", writeOnly: true }, receipt: { type: "string", readOnly: true } } };
    const outputSchema = { type: "object", properties: { value: { type: "string", deprecated: true } } };
    vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify([{ ...tool, inputSchema, outputSchema }]));
    const loaded = registry.loadToolRegistrySnapshot();
    expect(loaded.status).toBe("configured");
    expect(loaded.registry[0]).toMatchObject({ inputSchema, outputSchema, operationKind: "read" });
    expect(getMcpConnectionConfiguration()).toMatchObject({ status: "configured", connections: [{ id: "lookup", status: "configured" }] });
    expect(check).not.toHaveBeenCalled();
    vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify([{ ...tool, operationKind: undefined, inputSchema, outputSchema }]));
    expect(registry.loadToolRegistrySnapshot().status).toBe("configuration-error");
  });

  it("输入和回执格式说明经真实登记和诊断原样保留，不声称远端已可用", () => {
    const inputSchema = { type: "object", properties: { url: { type: "string", format: "uri" } } };
    const outputSchema = { type: "object", properties: { date: { type: "string", format: "date-time" }, extra: { format: "vendor-format" } } };
    vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify([{ ...tool, inputSchema, outputSchema }]));
    const loaded = registry.loadToolRegistrySnapshot();
    expect(loaded.status).toBe("configured");
    expect(loaded.registry).toHaveLength(1);
    expect(loaded.registry[0]).toMatchObject({ inputSchema, outputSchema });
    const result = getMcpConnectionConfiguration();
    expect(result).toMatchObject({ status: "configured", connections: [{ id: "lookup", status: "configured" }] });
    expect(result.message).toContain("尚未检查远端服务");
    expect(check).not.toHaveBeenCalled();
  });

  it.each([
    { outputSchema: { type: "string" } },
    { outputSchema: { type: ["number", "null"] } },
    { outputSchema: { type: "boolean" } },
  ])("真实登记接受的非对象回执规则在逐项诊断和检查中拒绝，不变成全局空目录 %#", async ({ outputSchema }) => {
    vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify([tool, { ...tool, id: "bad-output", outputSchema }]));
    expect(registry.loadToolRegistrySnapshot().status).toBe("configured");
    expect(registry.loadToolRegistrySnapshot().registry).toHaveLength(2);
    expect(getMcpConnectionConfiguration()).toMatchObject({ status: "partially-configured", connections: [
      { id: "lookup", status: "configured" }, { id: "bad-output", status: "configuration-error" },
    ] });
    expect(listMcpConnections()).toEqual([{ id: "lookup", name: tool.name }, { id: "bad-output", name: tool.name }]);
    expect((await inspectMcpConnection("bad-output")).status).toBe("configuration-error");
    expect(check).not.toHaveBeenCalled();
    const configured = registry.loadToolRegistrySnapshot().registry[1];
    const fetchImpl = vi.fn(async () => { throw new Error("坏回执配置不允许网络请求"); });
    await expect(invokeMcpTool({ tool: configured, action: configured.action, idempotencyKey: "output-preflight", input: {}, outputs: {}, fetchImpl }))
      .resolves.toEqual({ ok: false, retryable: false, error: "工具回执定义无效或超过容量，请检查服务端配置" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("超大回执规则经生产登记解析器保留，但在执行前拒绝且零网络", async () => {
    const outputSchema = { type: "object", description: "x".repeat(MAX_MCP_RESPONSE_BYTES) };
    const configured = registry.parseToolRegistry(JSON.stringify([{ ...tool, outputSchema }]));
    expect(configured).toHaveLength(1);
    expect(configured[0].outputSchema).toEqual(outputSchema);
    const fetchImpl = vi.fn(async () => { throw new Error("超大回执配置不允许网络请求"); });
    await expect(invokeMcpTool({ tool: configured[0], action: configured[0].action, idempotencyKey: "output-preflight", input: {}, outputs: {}, fetchImpl }))
      .resolves.toEqual({ ok: false, retryable: false, error: "工具回执定义无效或超过容量，请检查服务端配置" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([{ outputSchema: {} }, { outputSchema: { type: ["object", "null"] } },
    { outputSchema: { type: "object", description: "汉".repeat(12_000) } },
  ])("真实注册解析保留空规则、可空对象与超过参数容量的回执规则 %#", ({ outputSchema }) => {
    vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify([{ ...tool, outputSchema }]));
    expect(registry.loadToolRegistrySnapshot().status).toBe("configured");
    expect(registry.loadToolRegistrySnapshot().registry[0].outputSchema).toEqual(outputSchema);
    expect(getMcpConnectionConfiguration()).toMatchObject({ status: "configured", connections: [{ id: "lookup", status: "configured" }] });
    expect(check).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "  ", "[]"])("空配置 %s 返回未登记且未知检查不是配置错误", async (raw) => {
    vi.stubEnv("TOOL_REGISTRY_JSON", raw);
    expect(getMcpConnectionConfiguration()).toEqual({ status: "not-configured", message: "尚未登记连接", connections: [] });
    expect((await inspectMcpConnection("lookup")).status).toBe("not-found");
    expect(check).not.toHaveBeenCalled();
  });
  it.each(["{", "{}", JSON.stringify([tool, tool]), JSON.stringify([{ ...tool, headers: { Host: "bad.example" } }])])("全局非法配置明确返回错误而旧列表兼容 %#", async (raw) => {
    vi.stubEnv("TOOL_REGISTRY_JSON", raw);
    expect(getMcpConnectionConfiguration()).toEqual({ status: "configuration-error", message: "工具登记配置无效，请核对服务端配置", connections: [] });
    expect(listMcpConnections()).toEqual([]);
    expect((await inspectMcpConnection("lookup")).status).toBe("configuration-error");
    expect(check).not.toHaveBeenCalled();
  });
  it("合法的其他协议登记不被当成无效配置", async () => {
    vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify([{ ...tool, protocol: "http-json" }]));
    expect(getMcpConnectionConfiguration().status).toBe("not-configured");
    expect((await inspectMcpConnection("lookup")).status).toBe("not-found");
    expect(check).not.toHaveBeenCalled();
  });
  it.each([
    { headers: { Cookie: "private-fake-value" } },
    { inputSchema: { type: "object", description: "汉".repeat(12_000) } },
  ])("单项限制错误不隐藏其他合法连接 %#", (extra) => {
    vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify([tool, { ...tool, id: "broken", name: "待核对连接", ...extra }]));
    const result = getMcpConnectionConfiguration();
    expect(result.status).toBe("partially-configured");
    expect(result.connections.map(({ id, status }) => ({ id, status }))).toEqual([{ id: "lookup", status: "configured" }, { id: "broken", status: "configuration-error" }]);
    expect(listMcpConnections()).toHaveLength(2);
    expect(check).not.toHaveBeenCalled();
  });
  it("全部单项无效与全局无效不同，保留安全名称供定位", () => {
    vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify([{ ...tool, headers: { Cookie: "private-fake-value" } }]));
    const result = getMcpConnectionConfiguration();
    expect(result.status).toBe("configuration-error");
    expect(result.connections).toEqual([{ id: tool.id, name: tool.name, status: "configuration-error", message: "连接配置无效，请核对服务端配置" }]);
    expect(check).not.toHaveBeenCalled();
  });
  it("配置变化即更新状态，安全名称沿用注册解析，未验证网络可用性", () => {
    vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify([{ ...tool, name: "查询 Bearer abcdefghijklmnop" }]));
    const result = McpConnectionConfigurationResult.parse(getMcpConnectionConfiguration(DEMO_WORKSPACE_ID));
    expect(result.status).toBe("configured");
    expect(result.connections[0].name).toContain("已隐藏敏感信息");
    expect(result.message).toContain("尚未检查远端服务");
    expect(JSON.stringify(result)).not.toMatch(/abcdefghijklmnop|private-fake-value|private.example|endpoint|headers|inputSchema/);
    vi.stubEnv("TOOL_REGISTRY_JSON", "{");
    expect(getMcpConnectionConfiguration().status).toBe("configuration-error");
    vi.stubEnv("TOOL_REGISTRY_JSON", "[]");
    expect(getMcpConnectionConfiguration().status).toBe("not-configured");
    expect(check).not.toHaveBeenCalled();
  });
  it("其他工作区在读取全局快照前隔离，无配置状态泄漏和网络访问", async () => {
    vi.stubEnv("TOOL_REGISTRY_JSON", "{");
    const load = vi.spyOn(registry, "loadToolRegistrySnapshot").mockImplementation(() => { throw new Error("不允许读取全局登记"); });
    expect(getMcpConnectionConfiguration("another-workspace")).toEqual({ status: "not-configured", message: "尚未登记连接", connections: [] });
    expect(listMcpConnections("another-workspace")).toEqual([]);
    expect((await inspectMcpConnection("lookup", "another-workspace")).status).toBe("not-found");
    expect(load).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
  });
});
