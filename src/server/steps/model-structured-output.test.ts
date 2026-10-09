import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FatalError, RetryableError } from "workflow";
import { AgentManifest } from "@/contracts/manifest";
import { WorkflowNode } from "@/contracts/workflow";

const mocks = vi.hoisted(() => ({ generateText: vi.fn(), persistStep: vi.fn(), appendTrace: vi.fn(), provider: vi.fn() }));
vi.mock("ai", async (importOriginal) => ({ ...await importOriginal<typeof import("ai")>(), generateText: mocks.generateText }));
vi.mock("@ai-sdk/openai-compatible", () => ({ createOpenAICompatible: mocks.provider }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/server/steps/run-state", () => ({ persistStep: mocks.persistStep }));
vi.mock("@/server/steps/trace-step", () => ({ appendTrace: mocks.appendTrace }));
vi.mock("@/server/model/recorded-run-model", () => ({ recordRunModel: (model: unknown) => model }));
import { runModelStep } from "./model-step";

const schema = { type: "object", required: ["amount"], properties: { amount: { type: "number" } }, additionalProperties: false };
function nodeFor(overrides: Record<string, unknown> = {}) {
  return WorkflowNode.parse({
    id: "extract", title: "提取金额", type: "ai", modelOutput: { format: "json", schema, ...overrides },
  });
}
function manifestFor(node: WorkflowNode, mock = false) {
  return AgentManifest.parse({
    schemaVersion: "4.0", workflowFingerprint: "test",
    workflowSnapshot: { id: "test", rootAgent: { id: "test", name: "测试助手", role: "助手" }, nodes: { extract: node }, memoryPolicy: { taskContext: true, longTerm: false } },
    resourceSelection: { model: { modelId: "test-model", mock } }, inputContract: { fields: [] },
    designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
  });
}
function execute(node: WorkflowNode, mock = false) {
  return runModelStep({ runId: "00000000-0000-4000-8000-000000000001", node, manifest: manifestFor(node, mock), outputs: {}, input: {} });
}

beforeEach(() => {
  vi.stubEnv("MODEL_BASE_URL", "https://model.example.com/v1");
  vi.stubEnv("MODEL_API_KEY", "sk-private-test");
  vi.stubEnv("MODEL_ID", "test-model");
  mocks.generateText.mockReset();
  mocks.persistStep.mockReset().mockResolvedValue(undefined);
  mocks.appendTrace.mockReset().mockResolvedValue(undefined);
  mocks.provider.mockReset().mockReturnValue(() => ({}));
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("结构化模型执行", () => {
  it("下游模型使用冻结内部来源，保留零与否定值，不发送定位或其他成果", async () => {
    const node = WorkflowNode.parse({ ...nodeFor(), inputMapping: { fields: [
      { target: ["amount"], source: { kind: "output", nodeId: "group.extract", path: ["amount"] } },
      { target: ["approved"], source: { kind: "output", nodeId: "group.extract", path: ["approved"] } },
    ] } });
    mocks.generateText.mockResolvedValue({ output: { amount: 0 }, text: '{"amount":0}', usage: {} });
    await expect(runModelStep({ runId: "00000000-0000-4000-8000-000000000001", node, manifest: manifestFor(node), input: { other: "not-selected" },
      outputs: { group: { status: "completed", steps: [{ output: { amount: 0, approved: false, other: "not-selected" } }] } },
      inlineReferences: { "group.extract": { kind: "subflow", ownerNodeId: "group", stepIndex: 0 } },
    })).resolves.toEqual({ output: { amount: 0 } });
    const prompt = mocks.generateText.mock.calls[0][0].prompt;
    expect(prompt).toContain(JSON.stringify({ amount: 0, approved: false }, null, 2));
    expect(prompt).not.toContain("not-selected"); expect(prompt).not.toContain("ownerNodeId");
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
  });
  it("按字段契约校验对象，保存用量并返回可供条件和工具读取的对象", async () => {
    mocks.generateText.mockResolvedValue({ output: { amount: 100 }, text: '{"amount":100}', usage: { inputTokens: 12, outputTokens: 6 } });
    await expect(execute(nodeFor())).resolves.toEqual({ output: { amount: 100 } });
    expect(mocks.generateText).toHaveBeenCalledWith(expect.objectContaining({ output: expect.any(Object), maxRetries: 0, prompt: expect.stringContaining(JSON.stringify(schema)) }));
    expect(mocks.persistStep).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "succeeded", output: { output: { amount: 100 }, usage: { inputTokens: 12, outputTokens: 6 }, mock: false, repairCount: 0 },
    }));
  });

  it("先拒绝错误字段，再有限修正并累计两次用量，不保存错误结果", async () => {
    mocks.generateText.mockResolvedValueOnce({ output: { amount: "sk-invalid-result" }, usage: { inputTokens: 12, outputTokens: 6 } })
      .mockResolvedValueOnce({ output: { amount: 100 }, usage: { inputTokens: 8, outputTokens: 4 } });
    await expect(execute(nodeFor())).resolves.toEqual({ output: { amount: 100 } });
    expect(mocks.generateText).toHaveBeenCalledTimes(2);
    expect(mocks.generateText.mock.calls[1][0].prompt).toContain("上次结果格式或字段不符合要求");
    expect(mocks.persistStep).toHaveBeenLastCalledWith(expect.objectContaining({
      output: { output: { amount: 100 }, usage: { inputTokens: 20, outputTokens: 10 }, mock: false, repairCount: 1 },
    }));
    expect(JSON.stringify(mocks.persistStep.mock.calls)).not.toContain("sk-invalid-result");
    expect(JSON.stringify(mocks.appendTrace.mock.calls)).not.toContain("sk-invalid-result");
  });

  it.each([0, 1, 2])("按配置最多修正 %s 次，耗尽后永久失败", async (maxRepairAttempts) => {
    mocks.generateText.mockResolvedValue({ output: { amount: "bad" }, usage: { inputTokens: 1, outputTokens: 2 } });
    await expect(execute(nodeFor({ maxRepairAttempts }))).rejects.toThrow("模型结果未满足字段契约");
    expect(mocks.generateText).toHaveBeenCalledTimes(maxRepairAttempts + 1);
    expect(mocks.persistStep).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "failed", output: { usage: { inputTokens: maxRepairAttempts + 1, outputTokens: (maxRepairAttempts + 1) * 2 }, mock: false, repairCount: maxRepairAttempts },
    }));
  });

  it("真实输出模式由显式配置决定，不偷偷改变兼容服务的协议", async () => {
    mocks.generateText.mockResolvedValue({ output: { amount: 100 }, usage: {} });
    await execute(nodeFor({ providerMode: "json-schema" }));
    expect(mocks.provider).toHaveBeenCalledWith(expect.objectContaining({ supportsStructuredOutputs: true }));
    await execute(nodeFor({ providerMode: "json" }));
    expect(mocks.provider).toHaveBeenLastCalledWith(expect.objectContaining({ supportsStructuredOutputs: false }));
  });

  it("模拟输出只来自已配置且通过校验的样例，并明确记录模拟状态", async () => {
    await expect(execute(nodeFor({ mockOutput: { amount: 100 } }), true)).resolves.toEqual({ output: { amount: 100 } });
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(mocks.persistStep).toHaveBeenLastCalledWith(expect.objectContaining({ output: { output: { amount: 100 }, mock: true, repairCount: 0 } }));
    expect(mocks.appendTrace).toHaveBeenCalledWith(expect.objectContaining({ kind: "model.mock" }));
  });

  it("缺少模拟样例或字段规则无效时不伪造结构化成功", async () => {
    await expect(execute(nodeFor(), true)).rejects.toThrow("需要先配置");
    await expect(execute(nodeFor({ schema: { type: "object", unsupported: true } }))).rejects.toThrow("使用了暂不支持的规则");
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("网络瞬时错误保留工作流重试，不当成结果格式错误连续调用模型", async () => {
    mocks.generateText.mockRejectedValue(Object.assign(new Error("private-network-error"), { statusCode: 503 }));
    await expect(execute(nodeFor())).rejects.toBeInstanceOf(RetryableError);
    expect(mocks.generateText).toHaveBeenCalledOnce();
    expect(JSON.stringify(mocks.persistStep.mock.calls)).not.toContain("private-network-error");
  });

  it("持久化错误不被格式修正吞掉", async () => {
    const failure = new FatalError("步骤状态写入失败");
    mocks.generateText.mockResolvedValue({ output: { amount: 100 }, usage: {} });
    mocks.persistStep.mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure);
    await expect(execute(nodeFor())).rejects.toBe(failure);
    expect(mocks.generateText).toHaveBeenCalledOnce();
  });
});
