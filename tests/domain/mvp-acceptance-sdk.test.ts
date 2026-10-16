import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runToolStep } from "@/server/steps/tool-step";
import { runModelStep } from "@/server/steps/model-step";
import { invokeMcpTool } from "@/server/tools/invoke-mcp-tool";
import { createMvpAcceptanceFixture, startMvpAcceptanceTools } from "../helpers/mvp-acceptance-tools";
import { startModelJsonServer } from "../helpers/model-json-server";

const mocks = vi.hoisted(() => ({ persist: vi.fn(), trace: vi.fn(), operation: vi.fn() }));
vi.mock("workflow", async (original) => ({ ...await original<typeof import("workflow")>(), getStepMetadata: () => ({ attempt: 1, stepId: "acceptance-sdk-step" }) }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/server/services/harness-policies", () => ({ readRunHarnessPolicy: async () => ({ workspaceId: "00000000-0000-4000-8000-000000000001", snapshot: null }) }));
vi.mock("@/server/steps/run-state", () => ({ persistStep: mocks.persist }));
vi.mock("@/server/steps/trace-step", () => ({ appendTrace: mocks.trace }));
vi.mock("@/server/services/tool-operation", () => ({ invokeToolOperation: mocks.operation, hasDefaultHttpStepOperation: vi.fn().mockResolvedValue(false) }));
vi.mock("@/server/services/model-call", () => ({ beginRunModelCall: async () => ({ id: crypto.randomUUID() }), settleRunModelCall: async () => undefined }));

let tools: Awaited<ReturnType<typeof startMvpAcceptanceTools>> | undefined;
let model: Awaited<ReturnType<typeof startModelJsonServer>> | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.operation.mockImplementation(() => { throw new Error("账本只允许由隔离数据库套件执行"); });
});
afterEach(async () => {
  await tools?.close(); await model?.close(); tools = undefined; model = undefined;
  vi.unstubAllEnvs();
});
async function prepare(replies = ['{"customerId":"c1","amount":"wrong","approved":false}', '{"customerId":"c1","amount":0,"approved":false}']) {
  tools = await startMvpAcceptanceTools(); model = await startModelJsonServer(replies);
  const fixture = createMvpAcceptanceFixture(tools);
  vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify(fixture.registry));
  vi.stubEnv("HARNESS_POLICY_JSON", ""); vi.stubEnv("HARNESS_MAX_PROMPT_CHARS", "");
  vi.stubEnv("MODEL_BASE_URL", model.baseUrl + "/v1"); vi.stubEnv("MODEL_API_KEY", "test-only-key");
  vi.stubEnv("MODEL_ID", "test-model"); vi.stubEnv("REAL_MODELS_ENABLED", "1");
  return { ...fixture, runId: randomUUID() };
}

describe("MVP 真实模型/MCP SDK 边界（本机服务、模拟持久层）", () => {
  it("缺少映射来源时不初始化 MCP 连接", async () => {
    const fixture = await prepare();
    await expect(runToolStep({ runId: fixture.runId, node: fixture.manifest.workflowSnapshot.nodes.lookup, input: {}, outputs: {} }))
      .rejects.toMatchObject({ name: "FatalError" });
    expect(tools!.messages).toHaveLength(0); expect(model!.modelRequests).toHaveLength(0); expect(mocks.operation).not.toHaveBeenCalled();
  });
  it.each(["drift", 401, 403] as const)("远端失败 %s 在实际步骤中永久阻断", async (failure) => {
    const fixture = await prepare();
    if (failure === "drift") tools!.controls.readDrift = true; else tools!.controls.readStatus = failure;
    await expect(runToolStep({ runId: fixture.runId, node: fixture.manifest.workflowSnapshot.nodes.lookup, input: fixture.input, outputs: {} }))
      .rejects.toMatchObject({ name: "FatalError" });
    expect(tools!.messages.filter((message) => message.method === "tools/call")).toHaveLength(failure === "drift" ? 0 : 1);
    expect(model!.modelRequests).toHaveLength(0); expect(tools!.effectCount()).toBe(0); expect(mocks.operation).not.toHaveBeenCalled();
    expect(mocks.persist).toHaveBeenLastCalledWith(expect.objectContaining({ status: "failed" }));
    expect(JSON.stringify(mocks.trace.mock.calls)).not.toContain("test-only-never-log");
  });
  it("真实 SDK 修正后保留零值和否定值，模型只收到声明的字段", async () => {
    const fixture = await prepare(); const outputs: Record<string, unknown> = {};
    outputs.lookup = (await runToolStep({ runId: fixture.runId, node: fixture.manifest.workflowSnapshot.nodes.lookup, input: fixture.input, outputs })).receipt;
    const result = await runModelStep({ runId: fixture.runId, node: fixture.manifest.workflowSnapshot.nodes.proposal, manifest: fixture.manifest, input: fixture.input, outputs });
    expect(result.output).toEqual({ customerId: "c1", amount: 0, approved: false });
    expect(model!.modelRequests).toHaveLength(2); expect(JSON.stringify(model!.modelRequests)).not.toContain("must-not-send");
    expect(tools!.writes).toHaveLength(0); expect(mocks.operation).not.toHaveBeenCalled();
  });
  it("真实模型 SDK 修正耗尽仍抛永久失败，错误正文不保存", async () => {
    const fixture = await prepare(['{"customerId":"c1","amount":"test-only-never-log","approved":false}']);
    const node = fixture.manifest.workflowSnapshot.nodes.proposal;
    await expect(runModelStep({ runId: fixture.runId, node, manifest: fixture.manifest, input: fixture.input, outputs: { lookup: { customerId: "c1", amount: 0 } } }))
      .rejects.toMatchObject({ name: "FatalError" });
    expect(model!.modelRequests).toHaveLength(2); expect(tools!.writes).toHaveLength(0); expect(mocks.operation).not.toHaveBeenCalled();
    expect(mocks.persist).toHaveBeenLastCalledWith(expect.objectContaining({ status: "failed" }));
    expect(JSON.stringify({ persisted: mocks.persist.mock.calls, traces: mocks.trace.mock.calls })).not.toContain("test-only-never-log");
  });
  it("独立 MCP 写服务按外部键防重；此断言不替代数据库账本验收", async () => {
    const fixture = await prepare(); const tool = fixture.registry[1];
    const args = { tool, action: tool.action, idempotencyKey: "external-guarantee-test", input: { customerId: "c1", amount: 0, approved: false }, outputs: {} };
    const first = await invokeMcpTool(args), second = await invokeMcpTool(args);
    expect(first).toEqual(second); expect(first).toMatchObject({ ok: true, output: { receiptId: "receipt-1" } });
    expect(tools!.writes).toHaveLength(2); expect(tools!.effectCount()).toBe(1);
    expect(fixture.manifest.workflowSnapshot.nodes.record.toolOperation).toBeDefined();
  });
});
