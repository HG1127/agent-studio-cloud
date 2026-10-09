import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
const mocks = vi.hoisted(() => ({ load: vi.fn(), check: vi.fn() }));
vi.mock("@/server/tools/tool-registry", () => ({ loadToolRegistry: mocks.load }));
vi.mock("@/server/tools/mcp-connection-check", () => ({ checkMcpConnection: mocks.check }));
import { listMcpConnections, inspectMcpConnection } from "./mcp-connections";
const tool = { id: "lookup", name: "查询记录", action: "lookup", endpoint: "https://service.example/mcp", protocol: "mcp-streamable-http", headers: { Authorization: "Bearer secret" }, inputSchema: { type: "object" } };
beforeEach(() => { vi.clearAllMocks(); mocks.load.mockReturnValue([tool]); mocks.check.mockResolvedValue({ status: "available", message: "连接可用", tools: [] }); });
describe("已登记连接查询", () => {
  it("不返回地址凭据或原始定义", () => { expect(listMcpConnections()).toEqual([{ id: "lookup", name: "查询记录" }]); });
  it("隔离工作区，未知连接不发起网络访问", async () => {
    expect(listMcpConnections("another-workspace")).toEqual([]);
    expect((await inspectMcpConnection("lookup", "another-workspace")).status).toBe("not-found");
    expect((await inspectMcpConnection("unknown")).status).toBe("not-found"); expect(mocks.check).not.toHaveBeenCalled();
  });
  it("仅检查已登记且有效的 MCP 工具", async () => {
    await inspectMcpConnection("lookup", DEMO_WORKSPACE_ID);
    expect(mocks.check.mock.calls[0][0].endpoint).toBe(tool.endpoint);
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
