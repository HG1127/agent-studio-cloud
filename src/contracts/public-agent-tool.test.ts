import { describe, expect, it } from "vitest";
import { MAX_PUBLIC_TOOL_RECEIPT_BYTES, PublicToolCallInput, PublicToolCallReceipt, PublicToolManageInput, PublicToolManageResult, publicToolResponseFits } from "./public-agent-tool";
import { publicToolTestCall, publicToolTestView, PUBLIC_TOOL_TEST_IDS as ids } from "../../tests/fixtures/public-agent-tool";
import { presentPublicToolCall } from "@/server/domain/public-agent-tool";

describe("公开工具共享契约", () => {
  it("请求标识规范化，拒绝回调网址、跨工作区和自行选择版本", () => {
    const input = { requestId: ids.request.toUpperCase(), input: { amount: 0, approved: false } };
    expect(PublicToolCallInput.parse(input).requestId).toBe(ids.request);
    for (const extra of [{ workspaceId: ids.agent }, { callbackUrl: "https://external.example" }, { versionId: ids.version }]) {
      expect(PublicToolCallInput.safeParse({ ...input, ...extra }).success).toBe(false);
    }
  });
  it("所有管理写入要求明确确认，不能从调用正文发放凭据", () => {
    const input = { operation: "create", requestId: ids.request, name: "公开工具", confirmed: true };
    expect(PublicToolManageInput.safeParse(input).success).toBe(true);
    expect(PublicToolManageInput.safeParse({ ...input, confirmed: false }).success).toBe(false);
    expect(PublicToolManageInput.safeParse({ ...input, token: "never-submit" }).success).toBe(false);
  });
  it("列表/常规回执不容许秘密属性，只有发放动作允许一次明文", () => {
    const tool = publicToolTestView();
    expect(PublicToolManageResult.safeParse({ ok: true, tool: { ...tool, tokenHash: "secret" }, recordedRevision: 2 }).success).toBe(false);
    const receipt = presentPublicToolCall(publicToolTestCall(), null);
    expect(PublicToolCallReceipt.safeParse({ ...receipt, token: "pat_" + "a".repeat(64) }).success).toBe(false);
    expect(PublicToolCallReceipt.safeParse({ ...receipt, deliveryConfirmed: true }).success).toBe(false);
  });
  it("HTTP 回执容量按 UTF-8 与被动数据校验", () => {
    expect(publicToolResponseFits({ message: "中".repeat(Math.floor(MAX_PUBLIC_TOOL_RECEIPT_BYTES / 3) + 1) })).toBe(false);
    expect(publicToolResponseFits({ ok: true })).toBe(true);
    const getter = Object.defineProperty({}, "message", { enumerable: true, get: () => { throw new Error("不可执行"); } });
    expect(publicToolResponseFits(getter)).toBe(false);
  });
});
