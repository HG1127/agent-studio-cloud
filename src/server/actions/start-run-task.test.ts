import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ start: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/server/services/start-run-core", () => ({ startRunCore: mocks.start }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { startRunTaskAction } from "./start-run-task";

const ID = "00000000-0000-4000-8000-000000000161";
const REQUEST_ID = "00000000-0000-4000-8000-000000000162";
const input = { agentId: ID, requestId: REQUEST_ID, versionId: ID, input: { amount: 0, approved: false } };
beforeEach(() => {
  mocks.start.mockReset().mockResolvedValue({ ok: true, runId: ID });
  mocks.revalidate.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("程序化任务写入口", () => {
  it("复用页面启动防重命名空间并显式传递版本和业务输入", async () => {
    expect(await startRunTaskAction(input)).toEqual({ ok: true, runId: ID });
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith({ agentId: ID, versionId: ID, input: input.input, sourceType: "manual", sourceKey: `manual:${REQUEST_ID}` });
    expect(mocks.revalidate.mock.calls.map(([path]) => path)).toEqual([`/agents/${ID}`, "/agents", "/runs"]);
  });
  it("不符合契约的请求不进入执行引擎", async () => {
    expect(await startRunTaskAction({ ...input, requestId: "bad" })).toMatchObject({ ok: false });
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it.each([undefined, true])("保留业务失败及可重试标记 %s，供 HTTP 层准确映射", async (retryable) => {
    const result = { ok: false, error: "任务暂时无法启动", ...(retryable ? { retryable } : {}) };
    mocks.start.mockResolvedValueOnce(result);
    expect(await startRunTaskAction(input)).toEqual(result);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it("临时异常保留重试语义而不泄露底层秘密", async () => {
    mocks.start.mockRejectedValueOnce(new Error("postgres://private sk-private-key-123456"));
    const result = await startRunTaskAction(input);
    expect(result).toMatchObject({ ok: false, retryable: true });
    expect(JSON.stringify(result)).not.toMatch(/postgres|sk-private/);
  });
  it("错误的启动回执不能被当成成功", async () => {
    mocks.start.mockResolvedValueOnce({ ok: true, runId: "bad" });
    expect(await startRunTaskAction(input)).toMatchObject({ ok: false, retryable: true });
  });
  it("启动已提交后缓存刷新失败仍返回原任务标识", async () => {
    mocks.revalidate.mockImplementationOnce(() => { throw new Error("缓存暂时不可用"); });
    expect(await startRunTaskAction(input)).toEqual({ ok: true, runId: ID });
    expect(mocks.revalidate).toHaveBeenCalledTimes(3);
  });
});
