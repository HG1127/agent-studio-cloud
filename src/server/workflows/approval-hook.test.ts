import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createHook: vi.fn(), readDecision: vi.fn(), getConflict: vi.fn(), then: vi.fn(), dispose: vi.fn(),
}));
vi.mock("workflow", async (importOriginal) => ({
  ...await importOriginal<typeof import("workflow")>(),
  createHook: mocks.createHook,
}));
vi.mock("@/server/steps/approval-step", () => ({ readRecordedApprovalDecision: mocks.readDecision }));

import { awaitApprovalDecision } from "./approval-hook";

const handle = { approvalId: "approval-1", token: "approval:approval-1" };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createHook.mockReturnValue({ getConflict: mocks.getConflict, then: mocks.then, dispose: mocks.dispose });
  mocks.getConflict.mockResolvedValue(null);
  mocks.readDecision.mockResolvedValue(null);
  mocks.then.mockImplementation((resolve: (decision: { decision: "approved" }) => void) => resolve({ decision: "approved" }));
});

describe("审批注册与早到确认", () => {
  it("先确认入口注册，再读取落库决定，最后等待消息", async () => {
    const events: string[] = [];
    mocks.getConflict.mockImplementation(async () => { events.push("registered"); return null; });
    mocks.readDecision.mockImplementation(async () => { events.push("read"); return null; });
    mocks.then.mockImplementation((resolve: (decision: { decision: "approved" }) => void) => {
      events.push("received"); resolve({ decision: "approved" });
    });
    await expect(awaitApprovalDecision("run-1", handle)).resolves.toEqual({ decision: "approved" });
    expect(events).toEqual(["registered", "read", "received"]);
    expect(mocks.readDecision).toHaveBeenCalledWith({ runId: "run-1", approvalId: "approval-1" });
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it.each(["approved", "rejected"] as const)("早到的 %s 决定直接继续，不要求再次发送消息", async (decision) => {
    mocks.readDecision.mockResolvedValue({ decision, note: "已保存的意见" });
    await expect(awaitApprovalDecision("run-1", handle)).resolves.toEqual({ decision, note: "已保存的意见" });
    expect(mocks.then).not.toHaveBeenCalled();
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it("已有确定的决定时不新建消息入口", async () => {
    await expect(awaitApprovalDecision("run-1", { ...handle, recordedDecision: { decision: "approved" } }))
      .resolves.toEqual({ decision: "approved" });
    expect(mocks.createHook).not.toHaveBeenCalled();
    expect(mocks.readDecision).not.toHaveBeenCalled();
  });

  it("入口冲突不读取决定也不继续，释放本次入口", async () => {
    mocks.getConflict.mockResolvedValue({ runId: "other-run" });
    await expect(awaitApprovalDecision("run-1", handle)).rejects.toThrow("确认消息接收入口发生冲突");
    expect(mocks.readDecision).not.toHaveBeenCalled();
    expect(mocks.then).not.toHaveBeenCalled();
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });

  it.each(["注册", "读取"])("%s失败保留原错误并释放消息入口", async (stage) => {
    const failure = new Error("读取暂时失败");
    if (stage === "注册") mocks.getConflict.mockRejectedValue(failure);
    else mocks.readDecision.mockRejectedValue(failure);
    await expect(awaitApprovalDecision("run-1", handle)).rejects.toBe(failure);
    expect(mocks.then).not.toHaveBeenCalled();
    expect(mocks.dispose).toHaveBeenCalledOnce();
  });
});
