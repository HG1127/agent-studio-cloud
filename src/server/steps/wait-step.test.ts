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

  it("保存本次等待凭据后才开放等待状态", async () => {
    const order: string[] = [];
    mocks.appendTrace.mockImplementation(async () => { order.push("trace"); });
    mocks.returning.mockImplementation(async () => { order.push("status"); return [{ id: "run-1" }]; });

    await beginWait({ runId: "run-1", node, hookToken: "wait:run-1:wait_customer:1" });

    expect(order).toEqual(["trace", "status"]);
  });

  it("等待凭据未保存时不开放等待状态", async () => {
    mocks.appendTrace.mockRejectedValueOnce(new Error("temporary trace failure"));

    await expect(beginWait({ runId: "run-1", node, hookToken: "wait:run-1:wait_customer:1" }))
      .rejects.toThrow("temporary trace failure");
    expect(mocks.returning).not.toHaveBeenCalled();
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
  it("事件等待快照仍保留原凭据，无超时则不生成截止时间", async () => {
    await beginWait({ runId: "run-1", node, hookToken: "original-hook" });
    expect(mocks.appendTrace).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ hookToken: "original-hook", submissionToken: "submission-token", timing: { mode: "event", expectedAtMs: null } }) }));
  });
  it("定时等待只记录公开时间信息，不生成消息凭据", async () => {
    const timer = WorkflowNode.parse({ ...node, wait: { ...node.wait!, mode: "delay", durationMs: 1000 } });
    const before = Date.now();
    await beginWait({ runId: "run-1", node: timer });
    const event = mocks.appendTrace.mock.calls[0][0];
    expect(event.data.timing).toMatchObject({ mode: "delay", expectedAtMs: expect.any(Number) });
    expect(event.data.timing.expectedAtMs).toBeGreaterThanOrEqual(before + 1000);
    expect(Object.keys(event.data)).toEqual(["timing"]);
    expect(mocks.createWaitEventToken).not.toHaveBeenCalled();
  });
});
