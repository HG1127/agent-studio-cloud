import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { McpConnectionConfigurationResult } from "@/contracts/mcp-connection";
const check = vi.hoisted(() => vi.fn());
vi.mock("@/server/tools/mcp-connection-check", () => ({ checkMcpConnection: check }));
import { getMcpConnectionConfiguration, inspectMcpConnection, listMcpConnections } from "./mcp-connections";
import * as registry from "@/server/tools/tool-registry";

const tool = { id: "lookup", name: "查询记录", action: "lookup", scope: "record.read", protocol: "mcp-streamable-http", operationKind: "read", endpoint: "https://private.example/mcp", headers: { Authorization: "Bearer private-fake-value" }, inputSchema: { type: "object" } };
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("TOOL_REGISTRY_JSON", "");
  check.mockImplementation(() => { throw new Error("配置诊断不允许访问网络"); });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("真实注册解析的配置诊断查询", () => {
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
