import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectedRun: null as Record<string, unknown> | null,
  reconcileTerminalEvaluationRun: vi.fn(),
  revalidatePath: vi.fn(),
  appendTrace: vi.fn(),
  cancelWorkflowRunIfPresent: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => mocks.selectedRun ? [mocks.selectedRun] : []),
        })),
      })),
    })),
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("workflow/api", () => ({ getRun: vi.fn() }));
vi.mock("@/server/services/evaluation-state", () => ({
  completeEvaluationForRun: vi.fn(),
  reconcileTerminalEvaluationRun: mocks.reconcileTerminalEvaluationRun,
}));
vi.mock("@/server/steps/trace-step", () => ({ appendTrace: mocks.appendTrace }));
vi.mock("@/server/services/cancel-workflow-run", () => ({
  cancelWorkflowRunIfPresent: mocks.cancelWorkflowRunIfPresent,
}));

import { cancelRunAction } from "@/server/actions/cancel-run";

const RUN_ID = "00000000-0000-4000-8000-0000000000c1";

describe("取消运行幂等性", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cancelWorkflowRunIfPresent.mockResolvedValue("cancelled");
  });

  it("重复取消已取消运行时继续修复验收汇总并返回成功", async () => {
    mocks.selectedRun = {
      status: "cancelled",
      workflowRunId: "workflow-1",
      sourceType: "evaluation",
      sourceKey: "evaluation:00000000-0000-4000-8000-0000000000e1:00000000-0000-4000-8000-0000000000e2",
      stepStates: {},
      updatedAt: new Date(),
    };

    await expect(cancelRunAction(RUN_ID)).resolves.toEqual({ ok: true });

    expect(mocks.reconcileTerminalEvaluationRun).toHaveBeenCalledWith(RUN_ID);
    expect(mocks.cancelWorkflowRunIfPresent).toHaveBeenCalledWith("workflow-1");
    expect(mocks.appendTrace).toHaveBeenCalledWith(expect.objectContaining({ runId: RUN_ID, kind: "run.cancelled" }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/runs/${RUN_ID}`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/runs");
  });

  it("已经正常完成的运行仍然不能取消", async () => {
    mocks.selectedRun = {
      status: "completed",
      workflowRunId: "workflow-1",
      sourceType: "manual",
      sourceKey: null,
      stepStates: {},
      updatedAt: new Date(),
    };

    await expect(cancelRunAction(RUN_ID)).resolves.toEqual({ ok: false, error: "这次运行已经结束，无法取消" });
    expect(mocks.reconcileTerminalEvaluationRun).not.toHaveBeenCalled();
  });
});
