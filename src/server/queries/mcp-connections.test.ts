import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
const mocks = vi.hoisted(() => ({ load: vi.fn(), check: vi.fn() }));
vi.mock("@/server/tools/tool-registry", () => ({ loadToolRegistrySnapshot: () => {
  const registry = mocks.load();
  return { status: registry.length === 0 ? "not-configured" : "configured", registry };
} }));
vi.mock("@/server/tools/mcp-connection-check", () => ({ checkMcpConnection: mocks.check }));
import { getMcpConnectionConfiguration, listMcpConnections, inspectMcpConnection } from "./mcp-connections";
const tool = { id: "lookup", name: "查询记录", action: "lookup", endpoint: "https://service.example/mcp", protocol: "mcp-streamable-http", headers: { Authorization: "Bearer secret" }, inputSchema: { type: "object" }, outputSchema: { type: "object" } };
beforeEach(() => { vi.clearAllMocks(); mocks.load.mockReturnValue([tool]); mocks.check.mockResolvedValue({ status: "available", message: "连接可用", tools: [] }); });
afterEach(() => vi.unstubAllEnvs());
describe("已登记连接查询", () => {
  it("合法空数组检查未知登记返回未找到，而不是配置错误", async () => {
    vi.stubEnv("TOOL_REGISTRY_JSON", "[]");
    mocks.load.mockReturnValue([]);
    expect((await inspectMcpConnection("lookup")).status).toBe("not-found");
    expect(mocks.check).not.toHaveBeenCalled();
  });
  it("不返回地址凭据或原始定义", () => { expect(listMcpConnections()).toEqual([{ id: "lookup", name: "查询记录" }]); });
  it("隔离工作区，未知连接不发起网络访问", async () => {
    expect(listMcpConnections("another-workspace")).toEqual([]);
    expect((await inspectMcpConnection("lookup", "another-workspace")).status).toBe("not-found");
    expect((await inspectMcpConnection("unknown")).status).toBe("not-found"); expect(mocks.check).not.toHaveBeenCalled();
  });
  it("仅检查已登记且有效的 MCP 工具", async () => {
    await inspectMcpConnection("lookup", DEMO_WORKSPACE_ID);
    expect(mocks.check.mock.calls[0][0].endpoint).toBe(tool.endpoint);
    expect(mocks.check.mock.calls[0][2].get("lookup")).toEqual(tool.outputSchema);
    expect(mocks.check.mock.calls[0][2].size).toBe(1);
    mocks.load.mockReturnValue([{ ...tool, protocol: "http-json" }]); expect(listMcpConnections()).toEqual([]);
    mocks.load.mockReturnValue([{ ...tool, endpoint: "ftp://service.example/mcp" }]);
    expect((await inspectMcpConnection("lookup")).status).toBe("configuration-error");
    expect(mocks.check).toHaveBeenCalledTimes(1);
  });
});

it("相同地址但不同服务端凭据分别使用对应登记，不能串用", async () => {
  mocks.load.mockReturnValue([tool, { ...tool, id: "other", name: "另一查询", headers: { Authorization: "Bearer second-secret" } }]);
  await inspectMcpConnection("lookup"); await inspectMcpConnection("other");
  expect(mocks.check.mock.calls[0][0].headers.Authorization).toBe("Bearer secret");
  expect(mocks.check.mock.calls[1][0].headers.Authorization).toBe("Bearer second-secret");
  expect(JSON.stringify(listMcpConnections())).not.toContain("secret");
});

it("单项额外安全限制不隐藏其他合法登记，失败检查零网络", async () => {
  mocks.load.mockReturnValue([tool, { ...tool, id: "invalid", name: "配置待核对", headers: { Cookie: "secret" } }]);
  expect(listMcpConnections()).toHaveLength(2);
  expect((await inspectMcpConnection("invalid")).status).toBe("configuration-error");
  expect(mocks.check).not.toHaveBeenCalled();
  await inspectMcpConnection("lookup"); expect(mocks.check).toHaveBeenCalledTimes(1);
});

it("超出执行定义字节边界的配置不报可用，也不触发网络或隐藏其他连接", async () => {
  mocks.load.mockReturnValue([tool, { ...tool, id: "oversized", inputSchema: { type: "object", description: "汉".repeat(12_000) } }]);
  expect(listMcpConnections()).toHaveLength(2);
  expect((await inspectMcpConnection("oversized")).status).toBe("configuration-error");
  expect(mocks.check).not.toHaveBeenCalled();
  expect((await inspectMcpConnection("lookup")).status).toBe("available");
  expect(mocks.check).toHaveBeenCalledTimes(1);
});

it.each([
  { type: "object", properties: [] }, { type: "string" },
  { type: "object", $ref: "https://private.invalid/receipt" },
])("本地回执定义不可执行时逐项配置报错，检查零网络且保留其他合法连接 %#", async (outputSchema) => {
  mocks.load.mockReturnValue([tool, { ...tool, id: "invalid-output", name: "配置待核对", outputSchema }]);
  expect(listMcpConnections()).toHaveLength(2);
  expect(getMcpConnectionConfiguration()).toMatchObject({ status: "partially-configured", connections: [
    { id: "lookup", status: "configured" }, { id: "invalid-output", status: "configuration-error" },
  ] });
  expect((await inspectMcpConnection("invalid-output")).status).toBe("configuration-error");
  expect(mocks.check).not.toHaveBeenCalled();
  expect((await inspectMcpConnection("lookup")).status).toBe("available");
  expect(mocks.check).toHaveBeenCalledOnce();
  expect(JSON.stringify(getMcpConnectionConfiguration())).not.toContain("private.invalid");
});

it("连接诊断保留超过32KB的合法本地回执定义，不将它当作远端必需定义发送", async () => {
  mocks.load.mockReturnValue([{ ...tool, outputSchema: { type: "object", description: "汉".repeat(12_000) } }]);
  expect(getMcpConnectionConfiguration().status).toBe("configured");
  await inspectMcpConnection("lookup");
  expect(mocks.check).toHaveBeenCalledOnce();
  expect(mocks.check.mock.calls[0][0].tools[0]).not.toHaveProperty("outputSchema");
  expect(mocks.check.mock.calls[0][2].get("lookup")).toEqual({ type: "object", description: "汉".repeat(12_000) });
});
