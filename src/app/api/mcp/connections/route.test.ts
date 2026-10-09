import { describe, expect, it, vi } from "vitest";
const list = vi.hoisted(() => vi.fn());
vi.mock("@/server/queries/mcp-connections", () => ({ listMcpConnections: list }));
import { GET } from "./route";

describe("原连接列表兼容入口", () => {
  it.each([{ connections: [] }, { connections: [{ id: "lookup", name: "查询记录" }] }])("不加入新配置诊断字段 %#", async ({ connections }) => {
    list.mockReturnValue(connections);
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ connections });
  });
});
