import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendTrace: vi.fn(),
  getStepMetadata: vi.fn(() => ({ stepId: "workflow-step-7" })),
  transaction: vi.fn(),
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

function transactionClient() {
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
        from: () => ({ where: async () => [{ bytes: 0 }] }),
      };
    }),
    insert: vi.fn(() => ({
      values: () => ({ onConflictDoUpdate: async () => undefined }),
    })),
    update: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
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
});
