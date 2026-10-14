import { beforeEach, describe, expect, it, vi } from "vitest";
import { RetryableError } from "workflow";
const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { transaction: mocks.transaction } }));
import { beginRunModelCall, settleRunModelCall } from "./model-call";
const input = { runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", nodeId: "process", nodeTitle: "处理", modelId: "test", connectionId: null };
beforeEach(() => { mocks.transaction.mockReset(); });
describe("模型账本登记失败边界", () => {
  it("数据库失败保留安全可重试错误，不把连接串传给模型调用方", async () => {
    mocks.transaction.mockRejectedValue(new Error("postgres://operator:private-password@db.example"));
    let caught: unknown;
    try { await beginRunModelCall(input); } catch (error) { caught = error; }
    expect(RetryableError.is(caught)).toBe(true);
    expect(caught).toMatchObject({ message: "模型调用记录暂时无法建立，请稍后重试" });
    expect((caught as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(JSON.stringify(caught)).not.toContain("private-password");
  });
  it("非法意图与伪造归属在事务前拒绝，非法补记不能写库", async () => {
    await expect(beginRunModelCall({ ...input, runId: "bad" })).rejects.toThrow();
    await expect(beginRunModelCall({ ...input, workspaceId: "other" } as typeof input)).rejects.toThrow();
    await expect(settleRunModelCall({ id: input.runId, runId: input.runId, workspaceId: input.runId, state: "returned", measurement: null, failure: null })).rejects.toThrow();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
