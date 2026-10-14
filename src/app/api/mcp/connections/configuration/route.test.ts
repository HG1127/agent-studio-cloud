import { beforeEach, describe, expect, it, vi } from "vitest";
import { McpConnectionConfigurationResult } from "@/contracts/mcp-connection";
const query = vi.hoisted(() => vi.fn());
vi.mock("@/server/queries/mcp-connections", () => ({ getMcpConnectionConfiguration: query }));
import { GET } from "./route";
beforeEach(() => vi.clearAllMocks());

describe("只读连接配置诊断入口", () => {
  it.each([
    { status: "not-configured", connections: [] },
    { status: "configuration-error", connections: [] },
    { status: "configured", connections: [{ id: "lookup", name: "查询记录", status: "configured", message: "配置通过，尚未检查远端服务" }] },
    { status: "partially-configured", connections: [{ id: "lookup", name: "查询记录", status: "configured", message: "配置通过" }, { id: "broken", name: "待核对连接", status: "configuration-error", message: "请核对配置" }] },
  ])("状态 $status 返回共享契约且禁止缓存", async (state) => {
    const result = { ...state, message: "配置检查结果" };
    query.mockReturnValue(result);
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(McpConnectionConfigurationResult.parse(await response.json())).toEqual(result);
    expect(query.mock.calls).toEqual([[]]);
  });
  it("拒绝误带私有配置的响应而非泄露额外字段", () => {
    query.mockReturnValue({ status: "configuration-error", message: "配置需要核对", connections: [], endpoint: "https://private.example/mcp" });
    expect(() => GET()).toThrow();
  });
});
