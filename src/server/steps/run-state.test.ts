import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  returning: vi.fn(),
  selectRows: vi.fn(),
  appendTrace: vi.fn(),
  completeEvaluationForRun: vi.fn(),
  reconcileTerminalEvaluationRun: vi.fn(),
  setValues: vi.fn(),
}));

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
import { failRun, finalizeRun, initializeRun, markRunRunning, persistContext } from "@/server/steps/run-state";

const draft = {
  startNodeId: "start",
  rootAgent: { id: "agent-1", name: "客户助手", role: "服务客户" },
} as WorkflowDraft;

describe("运行终态步骤", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectRows.mockResolvedValue([]);
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

    await finalizeRun("run-1", { answer: "done" });

    expect(mocks.reconcileTerminalEvaluationRun).toHaveBeenCalledWith("run-1");
    expect(mocks.appendTrace).toHaveBeenCalledWith(expect.objectContaining({
      runId: "run-1",
      kind: "run.completed",
    }));
    expect(mocks.completeEvaluationForRun).not.toHaveBeenCalled();
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

  it("启动状态已提交后重入时补齐启动轨迹", async () => {
    mocks.returning.mockResolvedValue([]);
    mocks.selectRows
      .mockResolvedValueOnce([{ id: "run-1", workspaceId: "workspace-1", status: "running", stepStates: {} }])
      .mockResolvedValueOnce([{ status: "running", stepStates: {} }]);

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
