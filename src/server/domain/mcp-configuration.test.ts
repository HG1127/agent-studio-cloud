import { describe, expect, it } from "vitest";
import { buildMcpConnectionConfiguration } from "./mcp-configuration";

const good = { view: { id: "lookup", name: "查询记录" }, configured: true };
const bad = { view: { id: "broken", name: "待核对连接" }, configured: false };

describe("连接配置状态纯投影", () => {
  it.each(["not-configured", "configured"] as const)("没有连接不声称已配置 %s", (status) => {
    expect(buildMcpConnectionConfiguration(status, []).status).toBe("not-configured");
  });
  it("全局配置失败不投影残留登记", () => {
    expect(buildMcpConnectionConfiguration("configuration-error", [good])).toEqual({
      status: "configuration-error", message: "工具登记配置无效，请核对服务端配置", connections: [],
    });
  });
  it("所有单项配置通过仍明确未检查远端服务", () => {
    const result = buildMcpConnectionConfiguration("configured", [good]);
    expect(result.status).toBe("configured");
    expect(result.message).toContain("尚未检查远端服务");
    expect(result.connections).toEqual([{ ...good.view, status: "configured", message: "配置检查通过，尚未检查远端服务" }]);
  });
  it("部分错误保留每项配置状态和登记顺序", () => {
    const result = buildMcpConnectionConfiguration("configured", [bad, good]);
    expect(result.status).toBe("partially-configured");
    expect(result.connections.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "broken", status: "configuration-error" }, { id: "lookup", status: "configured" },
    ]);
  });
  it("全部单项错误仍保留诊断项，而非假装未配置", () => {
    const result = buildMcpConnectionConfiguration("configured", [bad]);
    expect(result.status).toBe("configuration-error");
    expect(result.connections).toHaveLength(1);
  });
  it("只选择公开字段，不投影调用者的私有字段或原因", () => {
    const view = { ...good.view, endpoint: "https://private.example/mcp", headers: { Authorization: "Bearer private-fake" }, message: "private-fake" };
    const result = buildMcpConnectionConfiguration("configured", [{ view, configured: true }]);
    expect(JSON.stringify(result)).not.toMatch(/private-fake|private.example|endpoint|headers/);
  });
});
