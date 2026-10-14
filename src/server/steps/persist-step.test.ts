import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendTrace: vi.fn(),
  getStepMetadata: vi.fn(() => ({ stepId: "workflow-step-7" })),
  transaction: vi.fn(),
  stepValues: vi.fn(),
  runValues: vi.fn(),
}));

vi.mock("workflow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("workflow")>();
  return { ...actual, getStepMetadata: mocks.getStepMetadata };
});
vi.mock("@/server/steps/trace-step", () => ({ appendTrace: mocks.appendTrace }));
vi.mock("@/server/services/evaluation-state", () => ({
  completeEvaluationForRun: vi.fn(),
  reconcileTerminalEvaluationRun: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ db: { transaction: mocks.transaction } }));

import { persistStep } from "@/server/steps/run-state";
import { MAX_RUN_STEP_OUTPUT_TOTAL_BYTES, MAX_STEP_OUTPUT_BYTES } from "@/server/domain/runtime/json-storage";

function transactionClient(aggregateBytes = 0) {
  let selectCount = 0;
  const tx = {
    select: vi.fn(() => {
      selectCount += 1;
      if (selectCount === 1) {
        return {
          from: () => ({
            where: () => ({
              for: () => ({
                limit: async () => [{ workspaceId: "workspace-1", createdBy: "user-1", status: "running", stepStates: {} }],
              }),
            }),
          }),
        };
      }
      return {
        from: () => ({ where: async () => [{ bytes: aggregateBytes }] }),
      };
    }),
    insert: vi.fn(() => ({
      values: (values: unknown) => {
        mocks.stepValues(values);
        return { onConflictDoUpdate: async () => undefined };
      },
    })),
    update: vi.fn(() => ({ set: (values: unknown) => {
      mocks.runValues(values);
      return { where: async () => undefined };
    } })),
  };
  return tx;
}

describe("步骤提交后的轨迹降级", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (work: (tx: ReturnType<typeof transactionClient>) => Promise<void>) => work(transactionClient()));
  });

  it("轨迹连续写入失败时不重放已经提交的业务步骤", async () => {
    mocks.appendTrace.mockRejectedValue(new Error("轨迹库暂时不可用"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(persistStep({
      runId: "run-1",
      nodeId: "draft_reply",
      nodeTitle: "拟定回复",
      nodeType: "ai",
      status: "succeeded",
      output: { output: "已生成" },
    })).resolves.toBeUndefined();

    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.appendTrace).toHaveBeenCalledTimes(2);
    expect(mocks.appendTrace).toHaveBeenNthCalledWith(1, expect.objectContaining({
      kind: "step.succeeded",
      dedupeKey: "step:workflow-step-7:draft_reply:succeeded",
    }));
    expect(mocks.appendTrace).toHaveBeenNthCalledWith(2, expect.objectContaining({
      dedupeKey: "step:workflow-step-7:draft_reply:succeeded",
    }));
    expect(errorLog).toHaveBeenCalledOnce();
    errorLog.mockRestore();
  });

  it("第一次回执不确定时用相同去重键补写轨迹", async () => {
    mocks.appendTrace.mockRejectedValueOnce(new Error("响应丢失")).mockResolvedValueOnce(undefined);

    await persistStep({
      runId: "run-1",
      nodeId: "fetch_policy",
      nodeType: "knowledge",
      status: "running",
    });

    expect(mocks.appendTrace).toHaveBeenCalledTimes(2);
    const first = mocks.appendTrace.mock.calls[0][0];
    const second = mocks.appendTrace.mock.calls[1][0];
    expect(first.dedupeKey).toBe("step:workflow-step-7:fetch_policy:running");
    expect(second.dedupeKey).toBe(first.dedupeKey);
  });

  it.each([0, 9, 10])("合法工具回执保留成功标记并提交成功状态（余量 %i 字节）", async (margin) => {
    mocks.appendTrace.mockResolvedValue(undefined);
    const raw = { receiptId: "r1", text: "" };
    raw.text = "x".repeat(MAX_STEP_OUTPUT_BYTES - margin - JSON.stringify(raw).length);
    const output = { ok: true, ...raw };
    await expect(persistStep({ runId: "run-1", nodeId: "write", nodeType: "tool", status: "succeeded", output }))
      .resolves.toBeUndefined();
    const stored = mocks.stepValues.mock.calls[0][0];
    expect(stored.status).toBe("succeeded");
    expect(stored.output).toBe(output);
    expect(stored.output.ok).toBe(true);
    expect(mocks.runValues).toHaveBeenCalledWith(expect.objectContaining({ stepStates: {
      write: expect.objectContaining({ status: "succeeded" }),
    } }));
    expect(mocks.appendTrace).toHaveBeenCalledWith(expect.objectContaining({ kind: "step.succeeded" }));
  });

  it.each(["tool", "ai", "knowledge"])("%s 的超限业务体仍以失败状态提交且抛永久失败", async (nodeType) => {
    mocks.appendTrace.mockResolvedValue(undefined);
    const output = { ok: true, text: "" };
    output.text = "x".repeat(MAX_STEP_OUTPUT_BYTES + 11 - JSON.stringify(output).length);
    await expect(persistStep({ runId: "run-1", nodeId: "large", nodeTitle: "超大结果", nodeType, status: "succeeded", output }))
      .rejects.toMatchObject({ name: "FatalError", message: "步骤「超大结果」的输出不能超过 1MB" });
    expect(mocks.stepValues).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", output: null }));
    expect(mocks.runValues).toHaveBeenCalledWith(expect.objectContaining({ stepStates: {
      large: expect.objectContaining({ status: "failed" }),
    } }));
    expect(mocks.appendTrace).toHaveBeenCalledWith(expect.objectContaining({ kind: "step.failed" }));
  });

  it("工具成功标记仍计入原4MB运行合计，恰好达限成功但多1字节失败", async () => {
    mocks.appendTrace.mockResolvedValue(undefined);
    const raw = { receiptId: "r1", text: "" };
    raw.text = "x".repeat(MAX_STEP_OUTPUT_BYTES - JSON.stringify(raw).length);
    const output = { ok: true, ...raw };
    const outputBytes = new TextEncoder().encode(JSON.stringify(output)).byteLength;
    mocks.transaction.mockImplementationOnce(async (work: (tx: ReturnType<typeof transactionClient>) => Promise<void>) =>
      work(transactionClient(MAX_RUN_STEP_OUTPUT_TOTAL_BYTES - outputBytes)));
    await expect(persistStep({ runId: "run-1", nodeId: "at_limit", nodeType: "tool", status: "succeeded", output }))
      .resolves.toBeUndefined();
    expect(mocks.stepValues.mock.calls[0][0].status).toBe("succeeded");
    mocks.transaction.mockImplementationOnce(async (work: (tx: ReturnType<typeof transactionClient>) => Promise<void>) =>
      work(transactionClient(MAX_RUN_STEP_OUTPUT_TOTAL_BYTES - outputBytes + 1)));
    await expect(persistStep({ runId: "run-1", nodeId: "over_limit", nodeType: "tool", status: "succeeded", output }))
      .rejects.toMatchObject({ name: "FatalError", message: "这次运行的步骤结果合计不能超过 4MB" });
    expect(mocks.stepValues.mock.calls[1][0]).toMatchObject({ status: "failed", output: null });
  });
});
