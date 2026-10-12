import { afterEach, describe, expect, it, vi } from "vitest";
import { FatalError } from "workflow";
import { AgentManifest } from "@/contracts/manifest";
import { WorkflowNode } from "@/contracts/workflow";
import { InputMapping } from "@/contracts/input-mapping";
import { startModelJsonServer } from "../../../tests/helpers/model-json-server";

const mocks = vi.hoisted(() => ({ persistStep: vi.fn(), appendTrace: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/server/services/harness-policies", () => ({ readRunHarnessPolicy: async () => ({ workspaceId: "00000000-0000-4000-8000-000000000001", snapshot: null }) }));
vi.mock("@/server/steps/run-state", () => ({ persistStep: mocks.persistStep }));
vi.mock("@/server/steps/trace-step", () => ({ appendTrace: mocks.appendTrace }));
vi.mock("@/server/services/model-call", () => ({
  beginRunModelCall: async (input: { runId: string }) => ({ id: crypto.randomUUID(), workspaceId: "00000000-0000-4000-8000-000000000002", runId: input.runId }),
  settleRunModelCall: async () => undefined,
}));
import { runModelStep } from "./model-step";

let service: Awaited<ReturnType<typeof startModelJsonServer>> | undefined;
const schema = {
  type: "object", required: ["amount", "approved"], additionalProperties: false,
  properties: { amount: { type: "number" }, approved: { type: "boolean" } },
};
async function execute(replies: string[], providerMode: "json" | "json-schema" = "json", maxRepairAttempts = 1, inputMapping?: InputMapping) {
  service = await startModelJsonServer(replies);
  vi.stubEnv("MODEL_BASE_URL", service.baseUrl + "/v1");
  vi.stubEnv("MODEL_API_KEY", "test-sdk-only-key");
  vi.stubEnv("MODEL_ID", "test-model");
  const node = WorkflowNode.parse({
    id: "extract", title: "提取金额", type: "ai", modelOutput: { format: "json", schema, providerMode, maxRepairAttempts }, ...(inputMapping ? { inputMapping } : {}),
  });
  const manifest = AgentManifest.parse({
    schemaVersion: "4.0", workflowFingerprint: "test",
    workflowSnapshot: { id: "test", rootAgent: { id: "test", name: "测试助手", role: "助手" }, nodes: { extract: node }, memoryPolicy: { taskContext: true, longTerm: false } },
    resourceSelection: { model: { modelId: "test-model", mock: false } }, inputContract: { fields: [] },
    designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
  });
  return runModelStep({
    runId: "00000000-0000-4000-8000-000000000001", node, manifest,
    outputs: { upstream: { amount: 18 }, private_step: { text: "must-not-send-step" } },
    input: { task: "提取订单金额", privateInfo: "must-not-send-input" },
  });
}
afterEach(async () => { await service?.close(); service = undefined; vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("实际 SDK 结构化输出协议", () => {
  it("首次请求和格式修正均仅使用映射字段，不夹带未选中的任务或上游数据", async () => {
    const mapping = InputMapping.parse({ fields: [
      { target: ["request"], source: { kind: "input", path: ["task"] } },
      { target: ["selectedAmount"], source: { kind: "output", nodeId: "upstream", path: ["amount"] } },
    ] });
    await expect(execute(['{"amount":"wrong","approved":true}', '{"amount":18,"approved":true}'], "json", 1, mapping))
      .resolves.toEqual({ output: { amount: 18, approved: true } });
    expect(service!.modelRequests).toHaveLength(2);
    for (const request of service!.modelRequests) {
      const content = (request.messages as Array<{ content: string }>).map((message) => message.content).join("\n");
      expect(content).toContain('"request": "提取订单金额"');
      expect(content).toContain('"selectedAmount": 18');
      expect(content).not.toContain("must-not-send");
      expect(content).not.toContain("private_step");
      expect(content).not.toContain("privateInfo");
    }
  });
  it("必填映射来源缺失时，不向模型发送任何请求", async () => {
    const mapping = InputMapping.parse({ fields: [{ target: ["request"], source: { kind: "input", path: ["missing"] } }] });
    await expect(execute([], "json", 1, mapping)).rejects.toBeInstanceOf(FatalError);
    expect(service!.modelRequests).toHaveLength(0);
    expect(mocks.persistStep).toHaveBeenLastCalledWith(expect.objectContaining({ status: "failed", error: expect.stringContaining("缺少映射字段") }));
  });
  it.each(["json", "json-schema"] as const)("%s 模式通过真实 HTTP、SDK 解析及应用字段校验，错误字段自动修正", async (mode) => {
    await expect(execute(['{"amount":123.5,"approved":true,"sk-private-field-name":"private-field-value"}', '{"amount":123.5,"approved":true}'], mode))
      .resolves.toEqual({ output: { amount: 123.5, approved: true } });
    expect(service!.modelRequests).toHaveLength(2);
    expect(service!.modelRequests[0].response_format).toEqual(mode === "json"
      ? { type: "json_object" }
      : { type: "json_schema", json_schema: { schema, strict: true, name: "response" } });
    expect(mocks.persistStep).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "succeeded", output: { output: { amount: 123.5, approved: true }, usage: { inputTokens: 24, outputTokens: 12 }, mock: false, repairCount: 1 },
    }));
    expect(JSON.stringify({ steps: mocks.persistStep.mock.calls, traces: mocks.appendTrace.mock.calls })).not.toContain("sk-private-field-name");
    expect(JSON.stringify({ steps: mocks.persistStep.mock.calls, traces: mocks.appendTrace.mock.calls })).not.toContain("private-field-value");
  });

  it("实际 SDK 的 JSON 解析错误也可以修正，错误文本不进入轨迹和步骤", async () => {
    await expect(execute(["sk-private-invalid-json", '{"amount":100,"approved":false}']))
      .resolves.toEqual({ output: { amount: 100, approved: false } });
    expect(service!.modelRequests).toHaveLength(2);
    expect(JSON.stringify(mocks.persistStep.mock.calls)).not.toContain("sk-private-invalid-json");
    expect(JSON.stringify(mocks.appendTrace.mock.calls)).not.toContain("sk-private-invalid-json");
  });

  it("实际 SDK 校验持续失败时只调用配置次数，终态仅保留用量和安全错误", async () => {
    await expect(execute(['{"amount":"sk-private-field-value","approved":true}'], "json", 2)).rejects.toBeInstanceOf(FatalError);
    expect(service!.modelRequests).toHaveLength(3);
    expect(mocks.persistStep).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "failed", output: { usage: { inputTokens: 36, outputTokens: 18 }, mock: false, repairCount: 2 },
    }));
    expect(JSON.stringify(mocks.persistStep.mock.calls)).not.toContain("sk-private-field-value");
    expect(JSON.stringify(mocks.appendTrace.mock.calls)).not.toContain("sk-private-field-value");
  });
});
