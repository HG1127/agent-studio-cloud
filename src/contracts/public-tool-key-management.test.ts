import { describe, expect, it } from "vitest";
import { PublicToolKeyManagementInput, PublicToolKeyManagementResult, PublicToolKeyManagementView } from "./public-tool-key-management";
import { publicToolTestView, PUBLIC_TOOL_TEST_IDS as ids } from "../../tests/fixtures/public-agent-tool";

const key = { keyId: ids.key, name: "业务调用方", expiresAt: null, revokedAt: null, createdAt: "2026-10-12T00:00:00.000Z" };
const view = { tool: publicToolTestView(), keys: [key], truncated: false };
describe("管理员工具凭据共享契约", () => {
  it("复用规范化工具标识且拒绝调用方指定工作区或身份", () => {
    expect(PublicToolKeyManagementInput.parse({ toolId: ids.tool.toUpperCase() })).toEqual({ toolId: ids.tool });
    for (const extra of [{ workspaceId: ids.agent }, { createdBy: ids.agent }, { token: "not-accepted" }]) {
      expect(PublicToolKeyManagementInput.safeParse({ toolId: ids.tool, ...extra }).success).toBe(false);
    }
  });
  it("详情可包含停用工具及到期、撤销元数据，没有重新发放明文语义", () => {
    const snapshot = { ...view, tool: { ...view.tool, status: "disabled" },
      keys: [{ ...key, expiresAt: "2026-10-10T00:00:00.000Z", revokedAt: "2026-10-11T00:00:00.000Z" }] };
    expect(PublicToolKeyManagementView.parse(snapshot)).toEqual(snapshot);
    expect(PublicToolKeyManagementResult.parse({ ok: true, ...view })).toEqual({ ok: true, ...view });
    expect(PublicToolKeyManagementResult.parse({ ok: false, code: "not_found", error: "找不到这个工具" })).toMatchObject({ ok: false });
  });
  it("最多返回一百条并明确截断，空清单同样有效", () => {
    expect(PublicToolKeyManagementView.safeParse({ ...view, keys: [], truncated: false }).success).toBe(true);
    expect(PublicToolKeyManagementView.safeParse({ ...view, keys: Array.from({ length: 100 }, () => key), truncated: true }).success).toBe(true);
    expect(PublicToolKeyManagementView.safeParse({ ...view, keys: Array.from({ length: 101 }, () => key) }).success).toBe(false);
  });
  it("回执和每条凭据均拒绝秘密字段和摘要属性", () => {
    for (const extra of [{ token: "not-for-list" }, { tokenHash: "a".repeat(64) }]) {
      expect(PublicToolKeyManagementResult.safeParse({ ok: true, ...view, ...extra }).success).toBe(false);
      expect(PublicToolKeyManagementView.safeParse({ ...view, keys: [{ ...key, ...extra }] }).success).toBe(false);
    }
  });
});
