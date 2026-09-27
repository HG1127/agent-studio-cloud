import { afterEach, describe, expect, it, vi } from "vitest";
import { FatalError, RetryableError } from "workflow";
import { AgentManifest } from "@/contracts/manifest";
import { WorkflowNode } from "@/contracts/workflow";

const mocks = vi.hoisted(() => ({ generateText: vi.fn(), persistStep: vi.fn(), select: vi.fn() }));
vi.mock("ai", () => ({ generateText: mocks.generateText }));
vi.mock("@ai-sdk/openai-compatible", () => ({ createOpenAICompatible: () => () => ({}) }));
vi.mock("@/lib/db", () => ({ db: { select: mocks.select } }));
vi.mock("@/server/steps/run-state", () => ({ persistStep: mocks.persistStep }));
vi.mock("@/server/steps/trace-step", () => ({ appendTrace: vi.fn() }));

import { runModelStep } from "@/server/steps/model-step";

const node = WorkflowNode.parse({ id: "analyze", title: "分析业务输入", type: "ai", next: "done" });
const manifest = AgentManifest.parse({
  schemaVersion: "4.0", workflowFingerprint: "test-fingerprint",
  workflowSnapshot: { id: "test", rootAgent: { id: "test", name: "测试助手", role: "助手" }, nodes: { analyze: node }, memoryPolicy: { taskContext: true, longTerm: false } },
  resourceSelection: { model: { modelId: "test-model", mock: false, connectionId: null } },
  inputContract: { fields: [] }, outputContract: { fields: [] }, designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
});

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); vi.restoreAllMocks(); });

describe("运行模型错误脱敏", () => {
  it.each(["FatalError", "RetryableError"] as const)("保留跨运行时的 %s 持久化错误", async (name) => {
    vi.stubEnv("MODEL_BASE_URL", "https://model.example.com/v1");
    vi.stubEnv("MODEL_API_KEY", "sk-private-test-value");
    vi.stubEnv("MODEL_ID", "test-model");
    mocks.generateText.mockReset().mockResolvedValue({ text: "正常答复", usage: { inputTokens: 1, outputTokens: 1 } });
    const failure = Object.assign(new Error("运行步骤写入失败"), {
      name,
      [name === "FatalError" ? "fatal" : "retryable"]: true,
    });
    expect(name === "FatalError" ? FatalError.is(failure) : RetryableError.is(failure)).toBe(true);
    expect(failure).not.toBeInstanceOf(name === "FatalError" ? FatalError : RetryableError);
    mocks.persistStep.mockReset().mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure);

    await expect(runModelStep({
      runId: "00000000-0000-4000-8000-000000000001", node, manifest, outputs: {}, input: {},
    })).rejects.toBe(failure);
    expect(mocks.persistStep).toHaveBeenCalledTimes(2);
    expect(mocks.persistStep.mock.calls.map(([value]) => value.status)).not.toContain("failed");
  });

  it("生产未开放真实模型时不向供应商发送请求", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REAL_MODELS_ENABLED", "");
    await expect(runModelStep({
      runId: "00000000-0000-4000-8000-000000000001", node, manifest, outputs: {}, input: {},
    })).rejects.toThrow("真实模型功能尚未开放");
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(mocks.persistStep.mock.calls.map(([value]) => value)).toContainEqual(expect.objectContaining({ status: "failed", error: "真实模型功能尚未开放" }));
  });

  it("读取连接失败时不把数据库诊断写入日志和运行错误", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.select.mockReturnValue({ from: () => ({ where: () => ({
      limit: () => Promise.reject(new Error("database private-connection-info")),
    }) }) });
    const withConnection = AgentManifest.parse({
      ...manifest,
      resourceSelection: { ...manifest.resourceSelection, model: { ...manifest.resourceSelection.model, connectionId: "00000000-0000-4000-8000-000000000002" } },
    });
    let thrown: unknown;
    try {
      await runModelStep({
        runId: "00000000-0000-4000-8000-000000000001", node, manifest: withConnection, outputs: {}, input: {},
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(RetryableError);
    expect((thrown as Error).message).toBe("读取模型连接失败，请稍后重试");
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-connection-info");
    expect(JSON.stringify(mocks.persistStep.mock.calls)).not.toContain("private-connection-info");
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it.each([401, 404, 429, 503])("上游 %s 不把密钥写入运行结果或抛出的错误，仍保留重试分类", async (statusCode) => {
    vi.stubEnv("MODEL_BASE_URL", "https://model.example.com/v1");
    vi.stubEnv("MODEL_API_KEY", "sk-private-test-value");
    vi.stubEnv("MODEL_ID", "test-model");
    mocks.generateText.mockRejectedValue(Object.assign(new Error("provider leaked sk-private-test-value"), { statusCode }));
    let thrown: unknown;
    try {
      await runModelStep({ runId: "00000000-0000-4000-8000-000000000001", node, manifest, outputs: {}, input: { input: "客户反馈" } });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(statusCode >= 429 ? RetryableError : FatalError);
    expect((thrown as Error).message).not.toContain("sk-private-test-value");
    const failed = mocks.persistStep.mock.calls.map(([value]) => value).find((value) => value.status === "failed");
    expect(failed).toBeDefined();
    expect(failed.error).not.toContain("sk-private-test-value");
    expect(failed.error).toMatch(/模型|连接|稍后/);
  });
});
