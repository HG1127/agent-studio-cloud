import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttentionHandlingInput } from "@/contracts/attention-handling";
const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("@/server/queries/attention", () => ({ findCurrentAttention: vi.fn() }));
vi.mock("@/server/queries/attention-cases", () => ({ presentAttentionCase: vi.fn() }));
import { recordAttentionHandlingAction } from "./record-attention-handling";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const input = AttentionHandlingInput.parse({ reference: { kind: "run-failed", id, runId: id, occurrence: "saved:failure" }, action: "acknowledge", requestId: id, expectedRevision: 0, reason: "已核对" });
beforeEach(() => vi.clearAllMocks());
describe("处理记录事务入口", () => {
  it.each([{ ...input, reason: " " }, { ...input, expectedRevision: -1 }, { ...input, workspaceId: id }, { ...input, action: "accept-failure" }])("非法或未经明确确认的直接调用不开始事务", async (raw) => {
    expect(await recordAttentionHandlingAction(raw as typeof input)).toMatchObject({ ok: false });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("事务结果未知要求沿用原请求，不回显数据库秘密或伪报写入成功", async () => {
    mocks.transaction.mockRejectedValueOnce(new Error("postgres://operator:private-password@db.example"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const result = await recordAttentionHandlingAction(input);
      expect(result).toMatchObject({ ok: false, retryable: true });
      expect(JSON.stringify(result)).not.toContain("private-password");
      expect(JSON.stringify(error.mock.calls)).not.toContain("private-password");
    } finally { error.mockRestore(); }
  });
});
