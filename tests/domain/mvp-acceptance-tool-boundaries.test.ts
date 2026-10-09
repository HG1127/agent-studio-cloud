import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
const mocks = vi.hoisted(() => ({ persist: vi.fn(), trace: vi.fn(), invoke: vi.fn(), registry: vi.fn(), attempt: 1 }));
vi.mock("workflow", async (original) => ({ ...await original<typeof import("workflow")>(), getStepMetadata: () => ({ attempt: mocks.attempt, stepId: "acceptance-step" }) }));
vi.mock("@/server/steps/run-state", () => ({ persistStep: mocks.persist }));
vi.mock("@/server/steps/trace-step", () => ({ appendTrace: mocks.trace }));
vi.mock("@/server/tools/invoke-tool", () => ({ invokeRegisteredTool: mocks.invoke }));
vi.mock("@/server/services/tool-operation", () => ({ invokeToolOperation: vi.fn() }));
vi.mock("@/server/steps/harness-policy-step", () => ({ enforceHarnessPolicy: vi.fn() }));
vi.mock("@/server/tools/tool-registry", () => ({ getToolRegistration: mocks.registry }));
import { runToolStep } from "@/server/steps/tool-step";
const node = WorkflowNode.parse({ id: "record", title: "登记方案", type: "tool", retry: { maxAttempts: 2, backoffMs: 50 },
  inputMapping: { fields: [
    { target: ["customerId"], source: { kind: "input", path: ["customerId"] } },
    { target: ["amount"], source: { kind: "output", nodeId: "proposal", path: ["amount"] } },
  ] },
  tool: { connector: "客户系统", registryToolId: "acceptance.record", protocol: "http-json", action: "record", scope: "customer.write", risk: "medium",
    inputSchema: { type: "object", required: ["input"], properties: { input: { type: "object", required: ["customerId", "amount"], properties: { customerId: { type: "string" }, amount: { type: "number" } } } } },
    outputSchema: { type: "object", required: ["receiptId"], properties: { receiptId: { type: "string" } } },
  },
});
const registration = { id: "acceptance.record", name: "客户系统", description: "", endpoint: "https://example.invalid/record", method: "POST", headers: {}, action: "record", scope: "customer.write", risk: "medium", inputSchema: node.tool!.inputSchema, outputSchema: node.tool!.outputSchema };
const args = { runId: "acceptance-run", node, input: { customerId: "c1" }, outputs: { proposal: { amount: 0 } } };
function expectFailure() {
  expect(mocks.persist).not.toHaveBeenCalledWith(expect.objectContaining({ status: "succeeded" }));
  expect(mocks.trace).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "tool.receipt" }));
  expect(mocks.persist).toHaveBeenLastCalledWith(expect.objectContaining({ status: "failed" }));
}
describe("MVP 工具失败边界（模拟传输与持久层）", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.attempt = 1; mocks.registry.mockReturnValue(registration); });
  it.each([
    { input: {}, outputs: { proposal: { amount: 0 } } },
    { input: { customerId: "c1" }, outputs: {} },
    { input: { customerId: "c1" }, outputs: { proposal: { amount: "invalid-model-output" } } },
  ])("缺参或模型字段错误不发送请求：%j", async (payload) => {
    await expect(runToolStep({ ...args, ...payload })).rejects.toMatchObject({ name: "FatalError" });
    expect(mocks.invoke).not.toHaveBeenCalled(); expectFailure();
  });
  it("注册目录输入规则漂移时阻断旧版本", async () => {
    mocks.registry.mockReturnValue({ ...registration, inputSchema: { type: "object", required: ["newField"] } });
    await expect(runToolStep(args)).rejects.toMatchObject({ name: "FatalError" });
    expect(mocks.invoke).not.toHaveBeenCalled(); expectFailure();
  });
  it("凭据类永久失败不转换成可重试失败", async () => {
    mocks.invoke.mockResolvedValue({ ok: false, retryable: false, error: "业务系统凭据无效" });
    await expect(runToolStep(args)).rejects.toMatchObject({ name: "FatalError" });
    expect(mocks.invoke).toHaveBeenCalledTimes(1); expectFailure();
  });
  it("暂时失败达到上限终止，尝试之间调用键稳定", async () => {
    mocks.invoke.mockResolvedValue({ ok: false, retryable: true, error: "业务系统暂时不可用" });
    await expect(runToolStep(args)).rejects.toMatchObject({ name: "RetryableError" });
    mocks.attempt = 2;
    await expect(runToolStep(args)).rejects.toMatchObject({ name: "FatalError" });
    expect(mocks.invoke.mock.calls.map(([call]) => call.idempotencyKey)).toEqual(["acceptance-run:record:acceptance-step", "acceptance-run:record:acceptance-step"]);
    expectFailure();
  });
  it.each([{ ok: false, receiptId: "rejected" }, { ok: true }, { ok: true, receiptId: 12 }])("失败或格式错误回执不产生成功结果：%j", async (output) => {
    mocks.invoke.mockResolvedValue({ ok: true, output });
    await expect(runToolStep(args)).rejects.toMatchObject({ name: "FatalError" }); expectFailure();
  });
});
