import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  returning: vi.fn(),
  selectRows: vi.fn(),
  appendTrace: vi.fn(),
  completeEvaluationForRun: vi.fn(),
  reconcileTerminalEvaluationRun: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({ returning: mocks.returning })),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: mocks.selectRows })),
      })),
    })),
  },
}));
vi.mock("@/server/steps/trace-step", () => ({ appendTrace: mocks.appendTrace }));
vi.mock("@/server/services/evaluation-state", () => ({
  completeEvaluationForRun: mocks.completeEvaluationForRun,
  reconcileTerminalEvaluationRun: mocks.reconcileTerminalEvaluationRun,
}));

import { finalizeRun, persistContext } from "@/server/steps/run-state";

describe("运行终态步骤", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectRows.mockResolvedValue([]);
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

  it("运行已结束时拒绝迟到的上下文并立即停止后续执行", async () => {
    mocks.returning.mockResolvedValue([]);
    mocks.selectRows.mockResolvedValue([{ id: "run-1" }]);

    await expect(persistContext("run-1", { answer: "late" }))
      .rejects.toThrow("运行已经结束，忽略迟到的上下文");
  });
});
