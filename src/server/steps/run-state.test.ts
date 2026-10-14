import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  returning: vi.fn(),
  selectRows: vi.fn(),
  appendTrace: vi.fn(),
  completeEvaluationForRun: vi.fn(),
  reconcileTerminalEvaluationRun: vi.fn(),
  setValues: vi.fn(),
  workflowMetadata: vi.fn(),
}));

vi.mock("workflow", async (original) => ({ ...await original<typeof import("workflow")>(), getWorkflowMetadata: mocks.workflowMetadata }));

vi.mock("@/lib/db", () => ({
  db: (() => {
    const client = {
    update: vi.fn(() => ({
      set: vi.fn((values: unknown) => {
        mocks.setValues(values);
        return ({
        where: vi.fn(() => ({ returning: mocks.returning })),
        });
      }),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: mocks.selectRows })),
      })),
    })),
    };
    return { ...client, transaction: async (callback: (tx: typeof client) => unknown) => callback(client) };
  })(),
}));
vi.mock("@/server/steps/trace-step", () => ({ appendTrace: mocks.appendTrace }));
vi.mock("@/server/services/evaluation-state", () => ({
  completeEvaluationForRun: mocks.completeEvaluationForRun,
  reconcileTerminalEvaluationRun: mocks.reconcileTerminalEvaluationRun,
}));

import type { WorkflowDraft } from "@/contracts/workflow";
import { failRun, finalizeRun, finalizeWorkflowResult, initializeRun, markRunRunning, persistContext } from "@/server/steps/run-state";
import { FatalError } from "workflow";

const draft = {
  startNodeId: "start",
  rootAgent: { id: "agent-1", name: "客户助手", role: "服务客户" },
} as WorkflowDraft;

describe("运行终态步骤", () => {
  it("收尾步骤只写最终选中成果并保留完整过程上下文", async () => {
    mocks.returning.mockResolvedValue([{ id: "run-1" }]);
    const outputs = { extract: { rows: [{ amount: 0, approved: false }], other: "未交付内容" } };
    const fields = ["amount", "approved"].map((name) => ({ path: `交付.${name}`, required: true, sourceNodeId: "extract", sourcePath: ["rows", "0", name] }));
    await finalizeWorkflowResult({ runId: "run-1", outputs, fields });
    const result = { 交付: { amount: 0, approved: false } };
    expect(mocks.setValues).toHaveBeenCalledWith(expect.objectContaining({ status: "completed", result, context: { outputs } }));
    expect(mocks.completeEvaluationForRun).toHaveBeenCalledWith("run-1", result);
  });
  it.each([
    { label: "必填缺失", outputs: { extract: {} }, sourcePath: ["amount"] },
    { label: "凭据字段", outputs: { extract: { password: "不应交付" } }, sourcePath: ["password"] },
    { label: "超限字段", outputs: { extract: { amount: "x".repeat(2 * 1024 * 1024 + 1) } }, sourcePath: ["amount"] },
  ])("$label 是永久失败且不写完成状态或触发验收", async ({ outputs, sourcePath }) => {
    await expect(finalizeWorkflowResult({ runId: "run-1", outputs, fields: [{ path: "交付", required: true, sourceNodeId: "extract", sourcePath }] })).rejects.toBeInstanceOf(FatalError);
    expect(mocks.setValues).not.toHaveBeenCalled(); expect(mocks.appendTrace).not.toHaveBeenCalled();
    expect(mocks.completeEvaluationForRun).not.toHaveBeenCalled(); expect(mocks.reconcileTerminalEvaluationRun).not.toHaveBeenCalled();
  });
  it.each(["completed", "cancelled"])("字段收尾重入 %s 保留原终态对账语义", async (status) => {
    mocks.returning.mockResolvedValue([]); mocks.selectRows.mockResolvedValue([{ status }]);
    await finalizeWorkflowResult({ runId: "run-1", outputs: { extract: { amount: 0 } }, fields: [{ path: "金额", required: true, sourceNodeId: "extract", sourcePath: ["amount"] }] });
    expect(mocks.reconcileTerminalEvaluationRun).toHaveBeenCalledTimes(Number(status === "completed"));
    expect(mocks.appendTrace).toHaveBeenCalledTimes(Number(status === "completed"));
    expect(mocks.completeEvaluationForRun).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectRows.mockResolvedValue([]);
    mocks.workflowMetadata.mockReturnValue({ workflowRunId: "wrun_state_test" });
  });

  it("失败终态、轨迹和验收只接收已脱敏的错误", async () => {
    mocks.returning.mockResolvedValue([{ id: "run-1" }]);
    const error = "联系 person@example.com，authorization: Bearer private-run-token";
    const safeError = "联系 [已隐藏敏感信息]，[已隐藏敏感信息]";
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await failRun("run-1", error);

    expect(mocks.setValues).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", error: safeError }));
    expect(mocks.appendTrace).toHaveBeenCalledWith(expect.objectContaining({ kind: "run.failed", detail: safeError }));
    expect(mocks.completeEvaluationForRun).toHaveBeenCalledWith("run-1", null, safeError);
    expect(JSON.stringify(log.mock.calls)).not.toContain("person@example.com");
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-run-token");
  });

  it("重入已结束的运行时继续修复验收汇总", async () => {
    mocks.returning.mockResolvedValue([]);
    mocks.selectRows.mockResolvedValue([{ status: "completed" }]);

    await finalizeRun("run-1", { answer: "done" });

    expect(mocks.reconcileTerminalEvaluationRun).toHaveBeenCalledWith("run-1");
    expect(mocks.appendTrace).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-1",
      kind: "run.completed",
    }));
    expect(mocks.completeEvaluationForRun).not.toHaveBeenCalled();
  });

  it("迟到的完成和失败回调不覆盖取消轨迹", async () => {
    mocks.returning.mockResolvedValue([]);
    mocks.selectRows.mockResolvedValue([{ status: "cancelled" }]);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await finalizeRun("run-1", { answer: "late" });
    await failRun("run-1", "迟到错误");

    expect(mocks.appendTrace).not.toHaveBeenCalled();
    expect(mocks.reconcileTerminalEvaluationRun).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("首次完成运行时写入轨迹并汇总验收", async () => {
    mocks.returning.mockResolvedValue([{ id: "run-1" }]);

    await finalizeRun("run-1", { answer: "done" });

    expect(mocks.appendTrace).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-1",
      kind: "run.completed",
    }));
    expect(mocks.completeEvaluationForRun).toHaveBeenCalledWith("run-1", { answer: "done" });
    expect(mocks.reconcileTerminalEvaluationRun).not.toHaveBeenCalled();
  });

  it("新任务首次初始化声明模型及协作关系覆盖", async () => {
    mocks.returning.mockResolvedValue([{ id: "run-1" }]);
    mocks.selectRows.mockResolvedValue([{ id: "run-1", workspaceId: "workspace-1", status: "queued", stepStates: {}, workflowRunId: null }]);

    await initializeRun("run-1", draft);

    expect(mocks.setValues).toHaveBeenCalledWith(expect.objectContaining({
      status: "running", workflowRunId: "wrun_state_test", modelUsageTrackingVersion: "v1", collaborationTrackingVersion: "v1",
    }));
  });

  it("启动状态已提交后重入时补齐启动轨迹", async () => {
    mocks.returning.mockResolvedValue([]);
    mocks.selectRows
      .mockResolvedValueOnce([{ id: "run-1", workspaceId: "workspace-1", status: "running", stepStates: {}, workflowRunId: "wrun_state_test" }])
      .mockResolvedValueOnce([{ status: "running", stepStates: {}, workflowRunId: "wrun_state_test" }]);

    await initializeRun("run-1", draft);

    expect(mocks.appendTrace).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-1",
      kind: "run.started",
      dedupeKey: "run-started:direct-call",
    }));
  });

  it("运行已结束时拒绝迟到的上下文并立即停止后续执行", async () => {
    mocks.returning.mockResolvedValue([]);
    mocks.selectRows.mockResolvedValue([{ id: "run-1" }]);

    await expect(persistContext("run-1", { answer: "late" }))
      .rejects.toThrow("运行已经结束，忽略迟到的上下文");
  });

  it("恢复状态已提交但轨迹失败时允许重入补齐轨迹", async () => {
    mocks.returning
      .mockResolvedValueOnce([{ id: "run-1" }])
      .mockResolvedValueOnce([]);
    mocks.selectRows.mockResolvedValueOnce([{ status: "running" }]);
    mocks.appendTrace.mockRejectedValueOnce(new Error("轨迹存储暂时不可用"));

    await expect(markRunRunning("run-1")).rejects.toThrow("轨迹存储暂时不可用");
    await expect(markRunRunning("run-1")).resolves.toBe(true);

    const resumed = mocks.appendTrace.mock.calls.filter(([event]) => event.kind === "run.resumed");
    expect(resumed).toHaveLength(2);
    expect(resumed[0][0].dedupeKey).toBe("run-resumed:direct-call");
    expect(resumed[1][0].dedupeKey).toBe(resumed[0][0].dedupeKey);
  });
});
