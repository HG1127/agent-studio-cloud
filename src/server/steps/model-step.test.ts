import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentManifest } from "@/contracts/manifest";
import { WorkflowNode } from "@/contracts/workflow";

const mocks = vi.hoisted(() => ({ appendTrace: vi.fn(), persistStep: vi.fn(), generateText: vi.fn() }));
vi.mock("@/server/steps/trace-step", () => ({ appendTrace: mocks.appendTrace }));
vi.mock("@/server/steps/run-state", () => ({ persistStep: mocks.persistStep }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("ai", () => ({ generateText: mocks.generateText }));

import { runModelStep } from "./model-step";

const node = WorkflowNode.parse({ id: "draft", title: "生成方案", type: "ai", next: null });
const manifest = { resourceSelection: { model: { modelId: "mock", mock: true, connectionId: null } } } as AgentManifest;
const originalPolicy = process.env.HARNESS_POLICY_JSON;
const originalLimit = process.env.HARNESS_MAX_PROMPT_CHARS;

beforeEach(() => { vi.clearAllMocks(); delete process.env.HARNESS_POLICY_JSON; delete process.env.HARNESS_MAX_PROMPT_CHARS; });
afterEach(() => {
  if (originalPolicy === undefined) delete process.env.HARNESS_POLICY_JSON; else process.env.HARNESS_POLICY_JSON = originalPolicy;
  if (originalLimit === undefined) delete process.env.HARNESS_MAX_PROMPT_CHARS; else process.env.HARNESS_MAX_PROMPT_CHARS = originalLimit;
});

describe("模型步骤 Harness 边界", () => {
  it("上下文超限时失败并留痕，不产生模拟或真实模型结果", async () => {
    await expect(runModelStep({ runId: "run-1", node, manifest, input: { task: "x".repeat(33_000) }, outputs: {} }))
      .rejects.toMatchObject({ name: "FatalError" });
    expect(mocks.persistStep).toHaveBeenLastCalledWith(expect.objectContaining({ status: "failed", nodeId: "draft" }));
    expect(mocks.appendTrace).toHaveBeenCalledWith(expect.objectContaining({ kind: "harness.context", data: expect.objectContaining({ allowed: false }) }));
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("正常输入通过检查并保存结果", async () => {
    await expect(runModelStep({ runId: "run-1", node, manifest, input: { task: "生成方案" }, outputs: {} }))
      .resolves.toMatchObject({ output: expect.stringContaining("[模拟输出]") });
    expect(mocks.appendTrace).toHaveBeenCalledWith(expect.objectContaining({ kind: "harness.context", data: expect.objectContaining({ allowed: true }) }));
    expect(mocks.persistStep).toHaveBeenLastCalledWith(expect.objectContaining({ status: "succeeded" }));
  });
});
