import { APICallError, generateText, NoObjectGeneratedError, Output, streamText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RetryableError } from "workflow";
const mocks = vi.hoisted(() => ({ begin: vi.fn(), settle: vi.fn() }));
vi.mock("@/server/services/model-call", () => ({ beginRunModelCall: mocks.begin, settleRunModelCall: mocks.settle }));
import { recordRunModel } from "./recorded-run-model";
const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", workspaceId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const reference = { runId, nodeId: "extract", nodeTitle: "提取金额", modelId: "test-model", connectionId: null };
const response = { content: [{ type: "text" as const, text: "业务答复" }], finishReason: { unified: "stop" as const, raw: "stop" }, warnings: [], usage: { inputTokens: { total: 12, noCache: undefined, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 6, text: undefined, reasoning: undefined } } };
beforeEach(() => { mocks.begin.mockReset().mockImplementation(async () => ({ id: crypto.randomUUID(), workspaceId, runId })); mocks.settle.mockReset().mockResolvedValue(undefined); });
describe("实际 AI SDK 每次供应商调用账本", () => {
  it("同一节点重复生成使用独立意图，不覆盖前一次用量且不保存输入或回复", async () => {
    const provider = new MockLanguageModelV4({ doGenerate: response }), model = recordRunModel(provider, reference);
    await generateText({ model, prompt: "private-request-one" }); await generateText({ model, prompt: "private-request-two" });
    expect(provider.doGenerateCalls).toHaveLength(2); expect(mocks.begin).toHaveBeenCalledTimes(2);
    const values = mocks.settle.mock.calls.map(([value]) => value);
    expect(new Set(values.map((value) => value.id)).size).toBe(2);
    expect(values).toEqual([expect.objectContaining({ state: "returned", measurement: expect.objectContaining({ knownTotalTokens: 18 }) }), expect.objectContaining({ state: "returned", measurement: expect.objectContaining({ knownTotalTokens: 18 }) })]);
    expect(JSON.stringify({ starts: mocks.begin.mock.calls, settles: values })).not.toMatch(/private-request|业务答复/);
  });
  it("SDK 内部重试逐次登记，第一次失败不虚报零用量", async () => {
    let attempt = 0;
    const provider = new MockLanguageModelV4({ doGenerate: async () => {
      if (attempt++ === 0) throw new APICallError({ message: "private-provider-error", url: "https://private.example", requestBodyValues: {}, statusCode: 503, isRetryable: true });
      return response;
    } });
    await generateText({ model: recordRunModel(provider, reference), prompt: "任务", maxRetries: 1 });
    expect(provider.doGenerateCalls).toHaveLength(2); expect(mocks.begin).toHaveBeenCalledTimes(2);
    expect(mocks.settle.mock.calls[0][0]).toMatchObject({ state: "failed", measurement: null, failure: "provider-unavailable" });
    expect(mocks.settle.mock.calls[1][0]).toMatchObject({ state: "returned", measurement: { knownTotalTokens: 18 } });
    expect(JSON.stringify(mocks.settle.mock.calls)).not.toContain("private");
  });
  it("响应内容解析失败仍记录已报告用量，不把格式错误变成供应商无调用", async () => {
    const provider = new MockLanguageModelV4({ doGenerate: { ...response, content: [{ type: "text", text: "private-invalid-json" }] } });
    await expect(generateText({ model: recordRunModel(provider, reference), prompt: "任务", output: Output.json(), maxRetries: 0 })).rejects.toSatisfy(NoObjectGeneratedError.isInstance);
    expect(mocks.settle).toHaveBeenCalledWith(expect.objectContaining({ state: "returned", measurement: expect.objectContaining({ inputTokens: 12, outputTokens: 6 }) }));
    expect(JSON.stringify(mocks.settle.mock.calls)).not.toContain("private-invalid-json");
  });
  it("意图建立失败不调用模型，保留持久步骤可重试语义", async () => {
    const failure = new RetryableError("记录暂时不可用", { retryAfter: "2s" }); mocks.begin.mockRejectedValue(failure);
    const provider = new MockLanguageModelV4({ doGenerate: response });
    await expect(generateText({ model: recordRunModel(provider, reference), prompt: "任务" })).rejects.toBe(failure);
    expect(provider.doGenerateCalls).toHaveLength(0); expect(mocks.settle).not.toHaveBeenCalled();
  });
  it("补记失败只重试同一记录，不触发 SDK 再次调用或隐藏原失败", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      mocks.settle.mockRejectedValue(new Error("private-ledger-error"));
      const provider = new MockLanguageModelV4({ doGenerate: response });
      await expect(generateText({ model: recordRunModel(provider, reference), prompt: "任务" })).resolves.toMatchObject({ text: "业务答复" });
      expect(provider.doGenerateCalls).toHaveLength(1); expect(mocks.settle).toHaveBeenCalledTimes(2);
      expect(mocks.settle.mock.calls[0][0]).toEqual(mocks.settle.mock.calls[1][0]);
      const original = new Error("original-provider-failure"), failed = new MockLanguageModelV4({ doGenerate: async () => { throw original; } });
      await expect(generateText({ model: recordRunModel(failed, reference), prompt: "任务", maxRetries: 0 })).rejects.toBe(original);
      expect(failed.doGenerateCalls).toHaveLength(1);
    } finally { log.mockRestore(); }
  });
  it("供应商未报告用量保持未知，不假装零用量", async () => {
    const empty = { inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: undefined, text: undefined, reasoning: undefined } };
    await generateText({ model: recordRunModel(new MockLanguageModelV4({ doGenerate: { ...response, usage: empty } }), reference), prompt: "任务" });
    expect(mocks.settle.mock.calls[0][0]).toMatchObject({ measurement: { inputTokens: null, outputTokens: null, knownTotalTokens: null } });
  });
  it("已开始调用的取消只记录安全类别，不保存供应商错误", async () => {
    const controller = new AbortController();
    const provider = new MockLanguageModelV4({ doGenerate: async () => { controller.abort(); throw new Error("private-aborted-response"); } });
    await expect(generateText({ model: recordRunModel(provider, reference), prompt: "任务", abortSignal: controller.signal, maxRetries: 0 })).rejects.toThrow();
    expect(provider.doGenerateCalls).toHaveLength(1);
    expect(mocks.settle).toHaveBeenCalledWith(expect.objectContaining({ state: "failed", failure: "aborted", measurement: null }));
    expect(JSON.stringify(mocks.settle.mock.calls)).not.toContain("private-aborted-response");
  });
  it("未接入的流式生成明确阻止，不能产生没有账本的供应商调用", async () => {
    const provider = new MockLanguageModelV4();
    const result = streamText({ model: recordRunModel(provider, reference), prompt: "任务", onError: () => undefined });
    await expect(result.text).rejects.toThrow(); expect(provider.doStreamCalls).toHaveLength(0); expect(mocks.begin).not.toHaveBeenCalled();
  });
});
