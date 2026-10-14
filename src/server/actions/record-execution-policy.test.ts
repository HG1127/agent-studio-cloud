import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXECUTION_RESOURCE_LIMITS } from "@/contracts/execution-resources";
const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { transaction: mocks.transaction } }));
import { recordExecutionPolicyAction } from "./record-execution-policy";
const input = { requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expectedRevision: 0, confirmed: true as const, limits: DEFAULT_EXECUTION_RESOURCE_LIMITS, reason: "试点" };
beforeEach(() => { mocks.transaction.mockReset(); vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => vi.restoreAllMocks());
describe("资源设置写入边界", () => {
  it("非法输入和伪造工作区不进入数据库", async () => {
    expect(await recordExecutionPolicyAction({ ...input, confirmed: false } as unknown as typeof input)).toMatchObject({ ok: false });
    expect(await recordExecutionPolicyAction({ ...input, workspaceId: "foreign" } as typeof input)).toMatchObject({ ok: false });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("保存结果不确定允许同一请求找回，不泄露数据库或凭据错误", async () => {
    mocks.transaction.mockRejectedValue(new Error("postgres://operator:private-password@db.example"));
    const result = await recordExecutionPolicyAction(input); expect(result).toMatchObject({ ok: false, retryable: true }); expect(JSON.stringify(result)).not.toContain("private-password");
  });
});
