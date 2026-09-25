import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";

const mocks = vi.hoisted(() => ({
  persistStep: vi.fn(), appendTrace: vi.fn(), invokeHttpTool: vi.fn(), getToolRegistration: vi.fn(), attempt: 1, stepId: "step-1",
}));
vi.mock("workflow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("workflow")>()),
  getStepMetadata: () => ({ stepName: "runToolStep", stepId: mocks.stepId, stepStartedAt: new Date(), attempt: mocks.attempt }),
}));
vi.mock("@/server/steps/run-state", () => ({ persistStep: mocks.persistStep }));
vi.mock("@/server/steps/trace-step", () => ({ appendTrace: mocks.appendTrace }));
vi.mock("@/server/tools/invoke-http-tool", () => ({ invokeHttpTool: mocks.invokeHttpTool }));
vi.mock("@/server/tools/tool-registry", () => ({ getToolRegistration: mocks.getToolRegistration }));

import { runToolStep } from "@/server/steps/tool-step";

const node = WorkflowNode.parse({
  id: "update_customer", title: "更新客户资料", type: "tool",
  tool: {
    connector: "客户系统", action: "update_customer", scope: "customer.write", risk: "medium",
    registryToolId: "crm.update", protocol: "http-json", inputSchema: { type: "object" },
    outputSchema: { type: "object", required: ["receiptId"], properties: { receiptId: { type: "string" } } },
  },
});
const registration = {
  id: "crm.update", name: "客户系统", description: "", endpoint: "https://tools.example.com/update",
  method: "POST", headers: {}, action: "update_customer", scope: "customer.write", risk: "medium",
  inputSchema: { type: "object" }, outputSchema: node.tool!.outputSchema,
};

describe("真实工具步骤", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.attempt = 1;
    mocks.stepId = "step-1";
    mocks.getToolRegistration.mockReturnValue(registration);
  });

  it("执行注册工具并持久化经过契约校验的业务回执", async () => {
    mocks.invokeHttpTool.mockResolvedValue({ ok: true, output: { receiptId: "receipt-1" } });
    await expect(runToolStep({ runId: "run-1", node, input: { customerId: "c1" }, outputs: {} }))
      .resolves.toEqual({ receipt: { receiptId: "receipt-1" } });
    expect(mocks.invokeHttpTool).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "run-1:update_customer:step-1", action: "update_customer", input: { customerId: "c1" },
    }));
    expect(mocks.persistStep).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "succeeded", output: { receiptId: "receipt-1" },
    }));
  });

  it("拒绝不符合冻结契约的业务回执", async () => {
    mocks.invokeHttpTool.mockResolvedValue({ ok: true, output: { ok: true } });
    await expect(runToolStep({ runId: "run-1", node, input: {}, outputs: {} }))
      .rejects.toThrow("业务系统回执不符合字段契约");
    expect(mocks.persistStep).toHaveBeenLastCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("调用前拒绝不符合冻结输入契约的数据", async () => {
    const strictNode = WorkflowNode.parse({
      ...node,
      tool: {
        ...node.tool!,
        inputSchema: {
          type: "object",
          required: ["input"],
          properties: {
            input: { type: "object", required: ["customerId"], properties: { customerId: { type: "string" } } },
          },
        },
      },
    });
    await expect(runToolStep({ runId: "run-1", node: strictNode, input: {}, outputs: {} }))
      .rejects.toThrow("工具输入不符合字段契约");
    expect(mocks.invokeHttpTool).not.toHaveBeenCalled();
  });

  it("保留外部系统瞬时失败的可重试语义", async () => {
    mocks.invokeHttpTool.mockResolvedValue({ ok: false, error: "业务系统暂时不可用，稍后自动重试", retryable: true });
    const retrying = runToolStep({ runId: "run-1", node, input: {}, outputs: {} });
    await expect(retrying).rejects.toMatchObject({ name: "RetryableError" });
    expect(mocks.persistStep).toHaveBeenLastCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("达到节点配置的总尝试次数后停止重试", async () => {
    mocks.attempt = 3;
    mocks.invokeHttpTool.mockResolvedValue({ ok: false, error: "业务系统持续不可用", retryable: true });
    await expect(runToolStep({ runId: "run-1", node, input: {}, outputs: {} }))
      .rejects.toMatchObject({ name: "FatalError" });
  });

  it("向 Workflow SDK 声明可覆盖节点配置的全局重试上限", () => {
    expect(runToolStep.maxRetries).toBe(7);
  });

  it("同一节点的不同步骤调用使用不同幂等键", async () => {
    mocks.invokeHttpTool.mockResolvedValue({ ok: true, output: { receiptId: "receipt-1" } });
    await runToolStep({ runId: "run-1", node, input: {}, outputs: {} });
    mocks.stepId = "step-2";
    await runToolStep({ runId: "run-1", node, input: {}, outputs: {} });
    expect(mocks.invokeHttpTool.mock.calls.map(([call]) => call.idempotencyKey)).toEqual([
      "run-1:update_customer:step-1",
      "run-1:update_customer:step-2",
    ]);
  });
});
