import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";

const mocks = vi.hoisted(() => ({
  persistStep: vi.fn(), appendTrace: vi.fn(), invokeHttpTool: vi.fn(), invokeToolOperation: vi.fn(), getToolRegistration: vi.fn(), attempt: 1, stepId: "step-1",
}));
vi.mock("workflow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("workflow")>()),
  getStepMetadata: () => ({ stepName: "runToolStep", stepId: mocks.stepId, stepStartedAt: new Date(), attempt: mocks.attempt }),
}));
vi.mock("@/server/steps/run-state", () => ({ persistStep: mocks.persistStep }));
vi.mock("@/server/services/harness-policies", () => ({ readRunHarnessPolicy: async () => ({ workspaceId: "00000000-0000-4000-8000-000000000001", snapshot: null }) }));
vi.mock("@/server/steps/trace-step", () => ({ appendTrace: mocks.appendTrace }));
vi.mock("@/server/tools/invoke-http-tool", () => ({ invokeHttpTool: mocks.invokeHttpTool }));
vi.mock("@/server/services/tool-operation", () => ({ invokeToolOperation: mocks.invokeToolOperation }));
vi.mock("@/server/tools/tool-registry", () => ({ getToolRegistration: mocks.getToolRegistration }));

import { runToolStep } from "@/server/steps/tool-step";
import { MAX_STEP_OUTPUT_BYTES, stepOutputStorageIssue } from "@/server/domain/runtime/json-storage";
import { validateToolOperationReceipt } from "@/server/domain/runtime/tool-operation";
import { FatalError } from "workflow";
import type { ToolRegistration } from "@/server/tools/tool-registry";

const node = WorkflowNode.parse({
  id: "update_customer", title: "更新客户资料", type: "tool",
  tool: {
    connector: "客户系统", action: "update_customer", scope: "customer.write", risk: "medium",
    registryToolId: "crm.update", protocol: "http-json", inputSchema: { type: "object" },
    outputSchema: { type: "object", required: ["receiptId"], properties: { receiptId: { type: "string" } } },
  },
});
const registration: ToolRegistration = {
  id: "crm.update", name: "客户系统", description: "", endpoint: "https://tools.example.com/update",
  method: "POST", headers: {}, action: "update_customer", scope: "customer.write", risk: "medium",
  inputSchema: { type: "object" }, outputSchema: node.tool!.outputSchema,
};

describe("真实工具步骤", () => {
  it("真实 HTTP 登记标识 demo 不会返回固定演示回执", async () => {
    const real = WorkflowNode.parse({ ...node, tool: { ...node.tool!, registryToolId: "demo" } });
    mocks.getToolRegistration.mockReturnValue({ ...registration, id: "demo" });
    mocks.invokeHttpTool.mockResolvedValue({ ok: true, output: { receiptId: "real-demo-receipt" } });
    await expect(runToolStep({ runId: "run-1", node: real, input: {}, outputs: {} }))
      .resolves.toEqual({ receipt: { ok: true, receiptId: "real-demo-receipt" } });
    expect(mocks.getToolRegistration).toHaveBeenCalledWith("demo");
    expect(mocks.invokeHttpTool).toHaveBeenCalledOnce();
  });
  it("真实 HTTP 登记 demo 缺失或已变更不能退化为演示成功", async () => {
    const real = WorkflowNode.parse({ ...node, tool: { ...node.tool!, registryToolId: "demo" } });
    for (const current of [null, { ...registration, id: "demo", scope: "customer.admin" }]) {
      mocks.getToolRegistration.mockReturnValue(current);
      await expect(runToolStep({ runId: "run-1", node: real, input: {}, outputs: {} })).rejects.toMatchObject({ name: "FatalError" });
    }
    expect(mocks.invokeHttpTool).not.toHaveBeenCalled();
    expect(mocks.persistStep).not.toHaveBeenCalledWith(expect.objectContaining({ status: "succeeded" }));
  });
  it("真实 HTTP 登记 demo 保留业务账本路径", async () => {
    const real = WorkflowNode.parse({ ...node, tool: { ...node.tool!, registryToolId: "demo" }, toolOperation: { scope: "crm-update", key: { kind: "literal", value: "c1" } } });
    mocks.getToolRegistration.mockReturnValue({ ...registration, id: "demo" });
    mocks.invokeToolOperation.mockResolvedValue({ ok: true, output: { receiptId: "saved-demo-receipt" }, operationId: "00000000-0000-4000-8000-000000000123", reused: true });
    await expect(runToolStep({ runId: "run-1", node: real, input: {}, outputs: {} })).resolves.toEqual({ receipt: { ok: true, receiptId: "saved-demo-receipt" } });
    expect(mocks.invokeToolOperation).toHaveBeenCalledOnce();
    expect(mocks.invokeHttpTool).not.toHaveBeenCalled();
  });
  it.each(["demo", "another-id", null])("显式演示协议保持固定回执且不调用真实工具 %#", async (registryToolId) => {
    const demo = WorkflowNode.parse({ ...node, tool: { ...node.tool!, registryToolId, protocol: "demo" } });
    await expect(runToolStep({ runId: "run-1", node: demo, input: {}, outputs: {} })).resolves.toEqual({ receipt: { ok: true, tool: "update_customer", summary: "演示工具已执行" } });
    expect(mocks.getToolRegistration).not.toHaveBeenCalled();
    expect(mocks.invokeHttpTool).not.toHaveBeenCalled();
    expect(mocks.invokeToolOperation).not.toHaveBeenCalled();
  });
  it("显式防重节点复用持久业务回执而不走普通外部调用", async () => {
    const protectedNode = WorkflowNode.parse({ ...node, toolOperation: { scope: "crm-update", key: { kind: "input", path: ["customerId"] } } });
    mocks.invokeToolOperation.mockResolvedValue({ ok: true, output: { receiptId: "receipt-1" }, operationId: "00000000-0000-4000-8000-000000000123", reused: true });
    await expect(runToolStep({ runId: "run-1", node: protectedNode, input: { customerId: "c1" }, outputs: {} }))
      .resolves.toEqual({ receipt: { ok: true, receiptId: "receipt-1" } });
    expect(mocks.invokeHttpTool).not.toHaveBeenCalled();
    expect(mocks.appendTrace).toHaveBeenCalledWith(expect.objectContaining({ kind: "tool.operation_reused" }));
  });
  it("并发业务操作使用服务给出的等待时间并保留 SDK 重试", async () => {
    const protectedNode = WorkflowNode.parse({ ...node, toolOperation: { scope: "crm-update", key: { kind: "literal", value: "c1" } } });
    mocks.invokeToolOperation.mockResolvedValue({ ok: false, error: "正在处理", retryable: true, retryAfterMs: 60_000 });
    await expect(runToolStep({ runId: "run-1", node: protectedNode, input: {}, outputs: {} })).rejects.toMatchObject({ name: "RetryableError" });
    expect(mocks.invokeHttpTool).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.persistStep.mockReset();
    mocks.attempt = 1;
    mocks.stepId = "step-1";
    mocks.getToolRegistration.mockReturnValue(registration);
  });

  it.each([
    { margin: 0, providerOk: false }, { margin: 9, providerOk: false },
    { margin: 10, providerOk: false }, { margin: 0, providerOk: true },
  ])("合法HTTP回执首次和缓存重入都能保留完整业务结果 %#", async ({ margin, providerOk }) => {
    const { invokeHttpTool } = await vi.importActual<typeof import("@/server/tools/invoke-http-tool")>("@/server/tools/invoke-http-tool");
    const raw: Record<string, unknown> = { receiptId: "r1", text: "" };
    if (providerOk) raw.ok = true;
    raw.text = "x".repeat(MAX_STEP_OUTPUT_BYTES - margin - new TextEncoder().encode(JSON.stringify(raw)).byteLength);
    const responseText = JSON.stringify(raw);
    expect(new TextEncoder().encode(responseText).byteLength).toBe(MAX_STEP_OUTPUT_BYTES - margin);
    const fetchImpl = vi.fn(async () => new Response(responseText, { status: 200 }));
    let cached: Record<string, unknown> | undefined;
    mocks.invokeToolOperation.mockImplementation(async () => {
      const reused = cached !== undefined;
      if (!cached) {
        const invoked = await invokeHttpTool({ tool: registration, idempotencyKey: "business-1", action: registration.action,
          input: {}, outputs: {}, fetchImpl });
        if (!invoked.ok) return invoked;
        const validated = validateToolOperationReceipt(invoked.output, node.tool!.outputSchema, registration.outputSchema);
        if (!validated.ok) return { ok: false, error: validated.error, retryable: false };
        cached = validated.value;
      }
      return { ok: true, output: cached, operationId: "00000000-0000-4000-8000-000000000123", reused };
    });
    mocks.persistStep.mockImplementation(async (step) => {
      if (step.output === undefined) return;
      const issue = stepOutputStorageIssue(step.output, step.nodeType, "步骤输出");
      if (issue) throw new FatalError(issue);
    });
    const protectedNode = WorkflowNode.parse({ ...node, toolOperation: { scope: "crm-update", key: { kind: "literal", value: "c1" } } });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await runToolStep({ runId: "run-1", node: protectedNode, input: {}, outputs: {} });
      expect(result.receipt.ok).toBe(true);
      expect(result.receipt.receiptId).toBe("r1");
      expect(result.receipt.text).toBe(raw.text);
      expect(new TextEncoder().encode(JSON.stringify(result.receipt)).byteLength)
        .toBe(MAX_STEP_OUTPUT_BYTES - margin + (providerOk ? 0 : 10));
    }
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(mocks.invokeHttpTool).not.toHaveBeenCalled();
    expect(mocks.invokeToolOperation).toHaveBeenCalledTimes(2);
    expect(mocks.appendTrace).toHaveBeenCalledWith(expect.objectContaining({ kind: "tool.operation_reused" }));
  });

  it("执行注册工具并持久化经过契约校验的业务回执", async () => {
    mocks.invokeHttpTool.mockResolvedValue({ ok: true, output: { receiptId: "receipt-1" } });
    await expect(runToolStep({ runId: "run-1", node, input: { customerId: "c1" }, outputs: {} }))
      .resolves.toEqual({ receipt: { ok: true, receiptId: "receipt-1" } });
    expect(mocks.invokeHttpTool).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "run-1:update_customer:step-1", action: "update_customer", input: { customerId: "c1" },
    }));
    expect(mocks.persistStep).toHaveBeenLastCalledWith(expect.objectContaining({
      status: "succeeded", output: { ok: true, receiptId: "receipt-1" },
    }));
    expect(mocks.appendTrace).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: "tool.receipt",
      data: { ok: true },
    }));
    expect(JSON.stringify(mocks.appendTrace.mock.calls)).not.toContain("receipt-1");
  });

  it("下游工具取得内部业务字段，不发送冻结定位或未选择成果", async () => {
    const mapped = WorkflowNode.parse({ ...node, inputMapping: { fields: [{ target: ["customerId"], source: { kind: "output", nodeId: "group.extract", path: ["id"] } }] } });
    mocks.invokeHttpTool.mockResolvedValue({ ok: true, output: { receiptId: "receipt-1" } });
    await expect(runToolStep({ runId: "run-1", node: mapped, input: {}, outputs: { group: { status: "completed", steps: [{ output: { id: "001", other: "not-selected" } }] } },
      inlineReferences: { "group.extract": { kind: "subflow", ownerNodeId: "group", stepIndex: 0 } },
    })).resolves.toEqual({ receipt: { ok: true, receiptId: "receipt-1" } });
    expect(mocks.invokeHttpTool).toHaveBeenCalledWith(expect.objectContaining({ input: { customerId: "001" }, outputs: {} }));
    expect(JSON.stringify(mocks.invokeHttpTool.mock.calls)).not.toContain("ownerNodeId");
    expect(JSON.stringify(mocks.invokeHttpTool.mock.calls)).not.toContain("not-selected");
  });

  it("不把业务系统显式失败的回执记录成成功步骤", async () => {
    mocks.invokeHttpTool.mockResolvedValue({ ok: true, output: { ok: false, receiptId: "receipt-rejected" } });
    await expect(runToolStep({ runId: "run-1", node, input: {}, outputs: {} }))
      .rejects.toThrow("业务系统回执表明操作未完成");
    expect(mocks.persistStep).toHaveBeenLastCalledWith(expect.objectContaining({ status: "failed" }));
    expect(mocks.persistStep).not.toHaveBeenCalledWith(expect.objectContaining({ status: "succeeded" }));
    expect(JSON.stringify(mocks.appendTrace.mock.calls)).not.toContain("receipt-rejected");
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
    mocks.getToolRegistration.mockReturnValue({ ...registration, inputSchema: strictNode.tool!.inputSchema });
    await expect(runToolStep({ runId: "run-1", node: strictNode, input: {}, outputs: {} }))
      .rejects.toThrow("工具输入不符合字段契约");
    expect(mocks.invokeHttpTool).not.toHaveBeenCalled();
  });

  it("只把映射业务字段传给工具，数字与布尔值不变，不夹带整份输入或上游", async () => {
    const mapped = WorkflowNode.parse({ ...node, inputMapping: { fields: [
      { target: ["customer", "id"], source: { kind: "input", path: ["customerId"] } },
      { target: ["amount"], source: { kind: "output", nodeId: "review", path: ["amount"] } },
      { target: ["approved"], source: { kind: "literal", value: true } },
    ] } });
    mocks.invokeHttpTool.mockResolvedValue({ ok: true, output: { receiptId: "receipt-1" } });
    await runToolStep({ runId: "run-1", node: mapped, input: { customerId: "c1", private: "not-for-tool" }, outputs: { review: { amount: 12.5 }, private: { note: "not-for-tool" } } });
    expect(mocks.invokeHttpTool).toHaveBeenCalledWith(expect.objectContaining({
      input: { customer: { id: "c1" }, amount: 12.5, approved: true }, outputs: {},
    }));
    expect(JSON.stringify(mocks.invokeHttpTool.mock.calls)).not.toContain("not-for-tool");
  });

  it("缺少必填映射来源时不调用外部系统", async () => {
    const mapped = WorkflowNode.parse({ ...node, inputMapping: { fields: [
      { target: ["customerId"], source: { kind: "input", path: ["missing"] } },
    ] } });
    await expect(runToolStep({ runId: "run-1", node: mapped, input: {}, outputs: {} })).rejects.toThrow("缺少映射字段");
    expect(mocks.invokeHttpTool).not.toHaveBeenCalled();
    expect(mocks.persistStep).toHaveBeenLastCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("映射后的字段仍通过冻结与当前服务端输入契约校验", async () => {
    const inputSchema = { type: "object", required: ["input"], properties: {
      input: { type: "object", required: ["amount"], properties: { amount: { type: "number" } } },
    } };
    const mapped = WorkflowNode.parse({ ...node, tool: { ...node.tool!, inputSchema }, inputMapping: { fields: [
      { target: ["amount"], source: { kind: "output", nodeId: "review", path: ["amount"] } },
    ] } });
    mocks.getToolRegistration.mockReturnValue({ ...registration, inputSchema });
    await expect(runToolStep({ runId: "run-1", node: mapped, input: {}, outputs: { review: { amount: "bad-value" } } })).rejects.toThrow("工具输入不符合字段契约");
    expect(mocks.invokeHttpTool).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.persistStep.mock.calls)).not.toContain("bad-value");
  });

  it("服务端工具权限或契约变化后拒绝旧冻结版本", async () => {
    mocks.getToolRegistration.mockReturnValue({ ...registration, scope: "customer.admin" });
    await expect(runToolStep({ runId: "run-1", node, input: {}, outputs: {} }))
      .rejects.toThrow("业务工具配置已变化，请重新发布助手");
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
