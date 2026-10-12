import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => {
  const rows: unknown[][] = [];
  const returning = vi.fn();
  const values = vi.fn();
  const insertValues = vi.fn();
  const client = {
    select: vi.fn(() => {
      const chain = { from: () => chain, where: () => chain, for: () => chain, limit: async () => rows.shift() ?? [] };
      return chain;
    }),
    update: vi.fn(() => ({ set: values })),
    insert: vi.fn(() => ({ values: insertValues })),
  };
  const transaction = vi.fn(async (callback: (tx: typeof client) => unknown) => callback(client));
  return { rows, returning, values, insertValues, transaction };
});
vi.mock("@/lib/db", () => ({ db: { transaction: mocks.transaction } }));
import { FatalError, RetryableError } from "workflow";
import { DEFAULT_RESULT_TRACKING_VERSION } from "@/contracts/default-result-delivery";
import { freezeDefaultResultFrame } from "@/server/domain/runtime/default-result-stream";
import { completeRunResult } from "./complete-run-result";

const runId = "11111111-1111-4111-8111-111111111111";
const run = {
  id: runId, workspaceId: "22222222-2222-4222-8222-222222222222", createdBy: "33333333-3333-4333-8333-333333333333",
  parentRunId: null, sourceType: "manual", workflowRunId: "wrun_completed", defaultResultTrackingVersion: DEFAULT_RESULT_TRACKING_VERSION,
  status: "running", result: null, finishedAt: null,
};
const input = { runId, expectedSdkRunId: run.workflowRunId, result: { amount: 0, approved: false }, contextOutputs: { internal: { answer: "过程" } }, outcome: "completed" as const };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows.length = 0;
  mocks.rows.push([{ ...run }]);
  mocks.returning.mockResolvedValue([{ id: runId }]);
  mocks.values.mockImplementation(() => ({ where: () => ({ returning: mocks.returning }) }));
  mocks.insertValues.mockResolvedValue(undefined);
});

describe("业务完成和冻结投递同一事务", () => {
  it("一次事务保存原正文、真实完成时间和同一归属的冻结帧", async () => {
    const completed = await completeRunResult(input);
    expect(completed.outcome).toEqual({ kind: "completed", runId, deliveryRequired: true });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    const saved = mocks.values.mock.calls[0][0];
    const outbox = mocks.insertValues.mock.calls[0][0];
    expect(saved).toMatchObject({ status: "completed", result: input.result, context: { outputs: input.contextOutputs } });
    expect(outbox).toMatchObject({ runId, workspaceId: run.workspaceId, createdBy: run.createdBy, sdkRunId: run.workflowRunId, status: "ready", producerSettled: true });
    expect(outbox.frozen.frame).toMatchObject({ runId, result: input.result, finishedAt: saved.finishedAt.toISOString() });
    expect(JSON.stringify(outbox.frozen)).not.toContain("过程");
  });
  it("帧插入错误传播到事务，不返回完成；实际回滚另由真库集成测试核验", async () => {
    mocks.insertValues.mockRejectedValueOnce(new Error("insert失败"));
    await expect(completeRunResult(input)).rejects.toBeInstanceOf(RetryableError);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.values).toHaveBeenCalledOnce();
  });
  it.each(["failed", "cancelled"])("迟到的%s运行返回明确stopped，不写结果或投递", async (status) => {
    mocks.rows[0] = [{ ...run, status }];
    await expect(completeRunResult(input)).resolves.toMatchObject({ outcome: { kind: "stopped", status } });
    expect(mocks.values).not.toHaveBeenCalled();
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });
  it("已完成重入使用原保存的正文和时间，不用调用者的新结果重新冻结", async () => {
    const finishedAt = new Date("2026-10-12T00:00:00.000Z");
    const result = { answer: "旧正文" };
    const frozen = freezeDefaultResultFrame({ runId, status: "completed", outcome: "completed", finishedAt: finishedAt.toISOString(), result });
    mocks.rows[0] = [{ ...run, status: "completed", result, finishedAt }];
    mocks.rows.push([{ frozen, sdkRunId: run.workflowRunId }]);
    await expect(completeRunResult(input)).resolves.toMatchObject({ result, newlyCompleted: false });
    expect(mocks.values).not.toHaveBeenCalled();
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });
  it.each(["missing", "changed-result", "changed-time", "changed-binding"])("重入%s记录不重新生成任何帧", async (kind) => {
    const finishedAt = new Date("2026-10-12T00:00:00.000Z");
    const result = { answer: "旧正文" };
    const frozen = freezeDefaultResultFrame({ runId, status: "completed", outcome: "completed", finishedAt: finishedAt.toISOString(), result });
    mocks.rows[0] = [{ ...run, status: "completed", result: kind === "changed-result" ? { answer: "变更" } : result, finishedAt: kind === "changed-time" ? new Date("2026-10-13T00:00:00.000Z") : finishedAt }];
    mocks.rows.push(kind === "missing" ? [] : [{ frozen, sdkRunId: kind === "changed-binding" ? "wrun_other" : run.workflowRunId }]);
    await expect(completeRunResult(input)).rejects.toBeInstanceOf(FatalError);
    expect(mocks.values).not.toHaveBeenCalled();
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });
  it("未获人工确认保持not_approved，不改写业务正文为成功", async () => {
    await completeRunResult({ ...input, outcome: "not_approved" });
    expect(mocks.insertValues.mock.calls[0][0].frozen.frame.outcome).toBe("not_approved");
  });
  it.each([undefined, "wrun_other"])("缺失或不匹配当前SDK身份%s不得首次完成或新生成帧", async (expectedSdkRunId) => {
    await expect(completeRunResult({ ...input, expectedSdkRunId })).rejects.toBeInstanceOf(FatalError);
    expect(mocks.values).not.toHaveBeenCalled();
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });
  it.each(["agent_call", "handoff"])("旧%s缺父也不产生默认根投递", async (sourceType) => {
    mocks.rows[0] = [{ ...run, sourceType }];
    await expect(completeRunResult(input)).resolves.toMatchObject({ outcome: { deliveryRequired: false } });
    expect(mocks.insertValues).not.toHaveBeenCalled();
  });
  it("缺执行身份或未脱敏凭据是永久失败，不写完成", async () => {
    mocks.rows[0] = [{ ...run, workflowRunId: null }];
    await expect(completeRunResult(input)).rejects.toBeInstanceOf(FatalError);
    mocks.rows.push([{ ...run }]);
    await expect(completeRunResult({ ...input, result: { apiKey: "private-do-not-send" } })).rejects.toBeInstanceOf(FatalError);
    expect(mocks.values).not.toHaveBeenCalled();
  });
});
