import { describe, expect, it } from "vitest";
import { McpConnectionConfigurationResult, McpConnectionListResult } from "@/contracts/mcp-connection";
import { ToolRegistryConfigurationStatus } from "@/contracts/tool-registry";

const good = { id: "lookup", name: "查询记录", status: "configured", message: "配置检查通过，尚未检查远端服务" };
const bad = { id: "broken", name: "待核对连接", status: "configuration-error", message: "请核对服务端配置" };

describe("连接配置状态共享契约", () => {
  it.each([
    { status: "not-configured", connections: [] },
    { status: "configured", connections: [good] },
    { status: "partially-configured", connections: [good, bad] },
    { status: "configuration-error", connections: [] },
    { status: "configuration-error", connections: [bad] },
  ])("接收一致的配置状态 $status", (result) => {
    expect(McpConnectionConfigurationResult.safeParse({ ...result, message: "配置检查结果" }).success).toBe(true);
  });
  it.each([
    { status: "configured", connections: [] },
    { status: "configured", connections: [bad] },
    { status: "not-configured", connections: [good] },
    { status: "partially-configured", connections: [good] },
    { status: "partially-configured", connections: [bad] },
    { status: "configuration-error", connections: [good] },
  ])("拒绝互相矛盾的配置状态 %#", (result) => {
    expect(McpConnectionConfigurationResult.safeParse({ ...result, message: "配置检查结果" }).success).toBe(false);
  });
  it("配置状态不混用在线状态，且拒绝私有字段、重复登记和越界数量", () => {
    const result = { status: "configured", connections: [good], message: "配置检查结果" };
    for (const field of ["endpoint", "headers", "workspaceId", "inputSchema", "reason"]) {
      expect(McpConnectionConfigurationResult.safeParse({ ...result, [field]: "private" }).success).toBe(false);
      expect(McpConnectionConfigurationResult.safeParse({ ...result, connections: [{ ...good, [field]: "private" }] }).success).toBe(false);
    }
    expect(McpConnectionConfigurationResult.safeParse({ ...result, status: "available" }).success).toBe(false);
    expect(McpConnectionConfigurationResult.safeParse({ ...result, connections: [{ ...good, status: "available" }] }).success).toBe(false);
    expect(McpConnectionConfigurationResult.safeParse({ ...result, connections: [good, good] }).success).toBe(false);
    expect(McpConnectionConfigurationResult.safeParse({ ...result, connections: Array.from({ length: 51 }, (_, i) => ({ ...good, id: `lookup-${i}` })) }).success).toBe(false);
    expect(ToolRegistryConfigurationStatus.safeParse("available").success).toBe(false);
  });
  it("旧列表契约仍严格只接收原字段", () => {
    const legacy = { connections: [{ id: good.id, name: good.name }] };
    expect(McpConnectionListResult.parse(legacy)).toEqual(legacy);
    expect(McpConnectionListResult.safeParse({ ...legacy, status: "configured" }).success).toBe(false);
  });
});
