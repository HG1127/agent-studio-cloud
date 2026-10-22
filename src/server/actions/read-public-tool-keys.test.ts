import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/server/queries/public-tool-keys", () => ({ getPublicToolKeys: mocks.read }));
import { readPublicToolKeysAction } from "./read-public-tool-keys";
import { publicToolTestView, PUBLIC_TOOL_TEST_IDS as ids } from "../../../tests/fixtures/public-agent-tool";

const admin = "keys-test-admin-".repeat(3), caller = "pat_" + "a".repeat(64);
const view = { tool: publicToolTestView(), keys: [{ keyId: ids.key, name: "业务调用方", expiresAt: null, revokedAt: null,
  createdAt: "2026-10-12T00:00:00.000Z" }], truncated: false };
beforeEach(() => { mocks.read.mockReset().mockResolvedValue(view); vi.stubEnv("PUBLIC_AGENT_TOOLS_ADMIN_TOKEN", admin); });
afterEach(() => vi.unstubAllEnvs());
describe("管理员工具凭据读取动作", () => {
  it("未鉴权、配置缺失和调用凭据均拒绝且不读取数据库", async () => {
    for (const token of ["", "wrong", caller, undefined as unknown as string]) {
      expect(await readPublicToolKeysAction(token, { toolId: ids.tool })).toMatchObject({ code: "unauthorized" });
    }
    vi.stubEnv("PUBLIC_AGENT_TOOLS_ADMIN_TOKEN", "");
    expect(await readPublicToolKeysAction(admin, { toolId: ids.tool })).toMatchObject({ code: "unauthorized" });
    vi.stubEnv("PUBLIC_AGENT_TOOLS_ADMIN_TOKEN", caller);
    expect(await readPublicToolKeysAction(caller, { toolId: ids.tool })).toMatchObject({ code: "unauthorized" });
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("标识错误或客户端工作区不进入查询", async () => {
    expect(await readPublicToolKeysAction(admin, { toolId: "invalid" })).toMatchObject({ code: "invalid" });
    expect(await readPublicToolKeysAction(admin, { toolId: ids.tool, workspaceId: ids.agent } as { toolId: string })).toMatchObject({ code: "invalid" });
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("规范标识后返回安全详情及可用于原撤销动作的凭据标识", async () => {
    expect(await readPublicToolKeysAction(admin, { toolId: ids.tool.toUpperCase() })).toEqual({ ok: true, ...view });
    expect(mocks.read).toHaveBeenCalledWith({ toolId: ids.tool });
  });
  it("不存在或归档工具明确找不到，空清单不冒充缺失工具", async () => {
    mocks.read.mockResolvedValueOnce(null);
    expect(await readPublicToolKeysAction(admin, { toolId: ids.tool })).toMatchObject({ code: "not_found" });
    mocks.read.mockResolvedValueOnce({ ...view, keys: [] });
    expect(await readPublicToolKeysAction(admin, { toolId: ids.tool })).toMatchObject({ ok: true, keys: [], truncated: false });
  });
  it("查询异常或异常回执只返回固定错误，不泄露原异常或秘密字段", async () => {
    mocks.read.mockRejectedValueOnce(new Error("password=never-return-private"));
    const failed = await readPublicToolKeysAction(admin, { toolId: ids.tool });
    expect(failed).toMatchObject({ code: "unavailable", retryable: true });
    expect(JSON.stringify(failed)).not.toContain("never-return-private");
    mocks.read.mockResolvedValueOnce({ ...view, tokenHash: "private-hash" });
    const malformed = await readPublicToolKeysAction(admin, { toolId: ids.tool });
    expect(malformed).toMatchObject({ code: "unavailable" });
    expect(JSON.stringify(malformed)).not.toContain("private-hash");
  });
});
