import { APICallError, generateText, RetryError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FatalError, RetryableError } from "workflow";
const mocks = vi.hoisted(() => ({ begin: vi.fn(), settle: vi.fn() }));
vi.mock("@/server/services/model-call", () => ({ beginRunModelCall: mocks.begin, settleRunModelCall: mocks.settle }));
import { recordRunModel } from "./recorded-run-model";
import { runModelControlError } from "./run-model-control-error";
afterEach(() => vi.clearAllMocks());
describe("模型 SDK 重试中的准入控制", () => {
  it("实际 SDK 重试包装保留第二次永久拒绝，供应商只调用一次", async () => {
    const denied = new FatalError("本次执行链已达到模型调用上限，不能继续发起新调用");
    mocks.begin.mockResolvedValueOnce({ id: crypto.randomUUID(), runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", workspaceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }).mockRejectedValueOnce(denied);
    mocks.settle.mockResolvedValue(undefined);
    const provider = new MockLanguageModelV4({ doGenerate: async () => { throw new APICallError({ message: "private-provider-failure", url: "https://provider.example", requestBodyValues: {}, statusCode: 503, isRetryable: true }); } });
    let caught: unknown;
    try { await generateText({ model: recordRunModel(provider, { runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", nodeId: "work", nodeTitle: "处理", modelId: "test", connectionId: null }), prompt: "任务", maxRetries: 1 }); } catch (error) { caught = error; }
    expect(provider.doGenerateCalls).toHaveLength(1); expect(mocks.begin).toHaveBeenCalledTimes(2); expect(mocks.settle).toHaveBeenCalledTimes(1); expect(runModelControlError(caught)).toBe(denied);
  });
  it("嵌套错误永久拒绝优先，不提取普通供应商错误或任意 cause", () => {
    const fatal = new FatalError("已停止"), retryable = new RetryableError("请重试", { retryAfter: "2s" });
    const nested = new RetryError({ message: "private-wrapper", reason: "errorNotRetryable", errors: [retryable, new RetryError({ message: "private-inner", reason: "maxRetriesExceeded", errors: [fatal] })] });
    expect(runModelControlError(nested)).toBe(fatal); expect(runModelControlError(retryable)).toBe(retryable); expect(runModelControlError(new Error("private-provider-error", { cause: fatal }))).toBeNull();
  });
  it("循环包装有界返回，不因坏供应商错误无限遍历", () => {
    const wrapper = new RetryError({ message: "bad-wrapper", reason: "maxRetriesExceeded", errors: [] }); wrapper.errors.push(wrapper); expect(runModelControlError(wrapper)).toBeNull();
  });
});
