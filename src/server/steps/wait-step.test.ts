import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";

const mocks = vi.hoisted(() => ({
  stepId: "wait-step-1",
  returning: vi.fn(),
  persistStep: vi.fn(),
  markRunRunning: vi.fn(),
  appendTrace: vi.fn(),
  createWaitEventToken: vi.fn(),
}));

vi.mock("workflow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("workflow")>()),
  getStepMetadata: () => ({ stepName: "waitStep", stepId: mocks.stepId, stepStartedAt: new Date(), attempt: 1 }),
}));
vi.mock("@/lib/db", () => ({
  db: {
    update: () => ({
      set: () => ({
        where: () => ({ returning: mocks.returning }),
      }),
    }),
  },
}));
vi.mock("@/server/security/wait-event-token", () => ({ createWaitEventToken: mocks.createWaitEventToken }));
vi.mock("@/server/steps/run-state", () => ({
  persistStep: mocks.persistStep,
  markRunRunning: mocks.markRunRunning,
}));
vi.mock("@/server/steps/trace-step", () => ({ appendTrace: mocks.appendTrace }));

import { beginWait, completeWait } from "@/server/steps/wait-step";

const node = WorkflowNode.parse({
  id: "wait_customer",
  title: "等待客户补充资料",
  type: "wait",
  next: "done",
  wait: {
    mode: "event",
    durationMs: 0,
    until: null,
    eventKey: "customer.updated",
    payloadSchema: { type: "object" },
    timeoutMs: 0,
    onTimeoutNext: null,
  },
});

describe("等待步骤重入", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stepId = "wait-step-1";
    mocks.returning.mockResolvedValue([{ id: "run-1" }]);
    mocks.markRunRunning.mockResolvedValue(true);
    mocks.createWaitEventToken.mockReturnValue("submission-token");
  });

  it("同一次等待重试时使用相同轨迹幂等键", async () => {
    const args = { runId: "run-1", node, hookToken: "wait:run-1:wait_customer:1" };

    await beginWait(args);
    await beginWait(args);

    const started = mocks.appendTrace.mock.calls.filter(([event]) => event.kind === "wait.started");
    expect(started).toHaveLength(2);
    expect(started[0][0].dedupeKey).toBe("wait-started:wait-step-1");
    expect(started[1][0].dedupeKey).toBe(started[0][0].dedupeKey);
  });

  it("等待完成重试时使用相同轨迹幂等键", async () => {
    const args = { runId: "run-1", node, output: { resumedBy: "event" } };

    await completeWait(args);
    await completeWait(args);

    const completed = mocks.appendTrace.mock.calls.filter(([event]) => event.kind === "wait.resumed");
    expect(completed).toHaveLength(2);
    expect(completed[0][0].dedupeKey).toBe("wait-completed:wait-step-1");
    expect(completed[1][0].dedupeKey).toBe(completed[0][0].dedupeKey);
  });
});
