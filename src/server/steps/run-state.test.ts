import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  returning: vi.fn(),
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
  },
}));
vi.mock("@/server/steps/trace-step", () => ({ appendTrace: mocks.appendTrace }));
vi.mock("@/server/services/evaluation-state", () => ({
  completeEvaluationForRun: mocks.completeEvaluationForRun,
  reconcileTerminalEvaluationRun: mocks.reconcileTerminalEvaluationRun,
}));

import { finalizeRun } from "@/server/steps/run-state";

describe("运行终态步骤", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("重入已结束的运行时继续修复验收汇总", async () => {
    mocks.returning.mockResolvedValue([]);

    await finalizeRun("run-1", { answer: "done" });

    expect(mocks.reconcileTerminalEvaluationRun).toHaveBeenCalledWith("run-1");
    expect(mocks.appendTrace).not.toHaveBeenCalled();
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
});
