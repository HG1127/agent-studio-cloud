import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), deliver: vi.fn(), resume: vi.fn(), getRun: vi.fn() }));
vi.mock("@/server/services/default-result-delivery", () => ({ readDefaultResultDelivery: mocks.read, deliverDefaultResult: mocks.deliver }));
vi.mock("workflow/api", () => ({ resumeHook: mocks.resume, getRun: mocks.getRun }));
import { FatalError } from "workflow";
import { type DefaultResultDeliveryRecord, type RecoverDefaultResultInput } from "@/contracts/default-result-delivery";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { freezeDefaultResultFrame } from "@/server/domain/runtime/default-result-stream";
import { recoverDefaultResultAction } from "./recover-default-result";

const runId = "11111111-1111-4111-8111-111111111111";
const now = "2026-10-12T00:00:00.000Z";
const record: DefaultResultDeliveryRecord = {
  runId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, sdkRunId: "wrun_recovery",
  frozen: freezeDefaultResultFrame({ runId, status: "completed", outcome: "completed", result: { answer: "完成" }, finishedAt: now }),
  status: "ready", writeAttempts: 0, operation: null, operationToken: null,
  waitingHookToken: null, waitingHookStepId: null, acknowledgement: "none", producerSettled: true,
  error: null, createdAt: now, updatedAt: now, confirmedAt: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue(record);
  mocks.deliver.mockResolvedValue({ status: "ready", hookToken: "unused" });
  mocks.resume.mockResolvedValue(undefined);
  mocks.getRun.mockReset().mockImplementation((runId: string) => ({ runId, status: Promise.resolve("running") }));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe("仅恢复已有成果投递的服务器动作", () => {
  it.each(["producerSettled", "workspaceId", "sdkRunId", "frameHash", "result"])("不接收客户端%s覆盖", async (field) => {
    expect(await recoverDefaultResultAction({ runId, mode: "retry", [field]: true } as RecoverDefaultResultInput)).toMatchObject({ ok: false });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.deliver).not.toHaveBeenCalled();
  });
  it("只读核对不执行写入恢复，工作区来自服务端", async () => {
    await expect(recoverDefaultResultAction({ runId, mode: "verify" })).resolves.toMatchObject({ ok: true, workflowNotified: false });
    expect(mocks.deliver).toHaveBeenCalledWith(runId, DEMO_WORKSPACE_ID, true);
    expect(mocks.resume).not.toHaveBeenCalled();
  });
  it("无可访问成果就不恢复，不能另启动任务", async () => {
    mocks.read.mockResolvedValue(null);
    expect(await recoverDefaultResultAction({ runId, mode: "retry" })).toMatchObject({ ok: false });
    expect(mocks.deliver).not.toHaveBeenCalled();
    expect(mocks.resume).not.toHaveBeenCalled();
  });
  it("归属不符是永久拒绝，不能发送其它任务成果", async () => {
    mocks.read.mockResolvedValue({ ...record, workspaceId: "22222222-2222-4222-8222-222222222222" });
    expect(await recoverDefaultResultAction({ runId, mode: "retry" })).toMatchObject({ ok: false, retryable: false });
    expect(mocks.deliver).not.toHaveBeenCalled();
  });
  it("只有可信终态才唤醒当前保存的随机Hook，视图不泄漏正文或token", async () => {
    mocks.read.mockResolvedValue({ ...record, status: "confirmed", acknowledgement: "confirmed", confirmedAt: now, waitingHookToken: "private-current-hook", waitingHookStepId: "step_one" });
    const result = await recoverDefaultResultAction({ runId, mode: "retry" });
    expect(result).toMatchObject({ ok: true, workflowNotified: true, delivery: { status: "confirmed", canRetry: false } });
    expect(mocks.resume).toHaveBeenCalledWith("private-current-hook", { kind: "delivery-updated" });
    expect(mocks.getRun).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/private-current-hook|step_one|wrun_recovery|frameHash|answer/);
  });
  it("早到通知失败保留真实送达，不能把通知失败当发送失败", async () => {
    mocks.read.mockResolvedValue({ ...record, status: "confirmed", acknowledgement: "confirmed", confirmedAt: now, waitingHookToken: "private-hook", waitingHookStepId: "step_one" });
    mocks.resume.mockRejectedValue(new Error("hook尚未注册"));
    await expect(recoverDefaultResultAction({ runId, mode: "retry" })).resolves.toMatchObject({
      ok: true, workflowNotified: false, workflowNotificationPending: true, delivery: { status: "confirmed", canRetry: false, canVerify: true },
    });
    expect(mocks.getRun).toHaveBeenCalledWith(record.sdkRunId);
  });
  it("永久错误回执安全且不可自动重试", async () => {
    mocks.deliver.mockRejectedValue(new FatalError("内部详情"));
    expect(await recoverDefaultResultAction({ runId, mode: "retry" })).toMatchObject({ ok: false, retryable: false });
  });
});

describe("通知失败只重试控制消息，不虚报根流程已恢复", () => {
  beforeEach(() => {
    mocks.read.mockResolvedValue({ ...record, status: "confirmed", acknowledgement: "confirmed", confirmedAt: now,
      waitingHookToken: "private-current-hook", waitingHookStepId: "step_one" });
    mocks.resume.mockRejectedValue(new Error("通知响应暂时不可用"));
  });
  it.each(["completed", "failed", "cancelled"])("通知ACK丢失但实际引擎已%s，不制造永久重试", async (status) => {
    mocks.getRun.mockReturnValue({ runId: record.sdkRunId, status: Promise.resolve(status) });
    const result = await recoverDefaultResultAction({ runId, mode: "verify" });
    expect(result).toMatchObject({ ok: true, workflowNotified: false, delivery: { status: "confirmed", canRetry: false } });
    expect(result).not.toHaveProperty("workflowNotificationPending");
  });
  it.each(["unreadable", "rejected", "other-run", "unexpected"])("引擎%s不能当作已结束证据", async (variant) => {
    if (variant === "unreadable") mocks.getRun.mockImplementation(() => { throw new Error("password=private-never-return"); });
    if (variant === "rejected") mocks.getRun.mockReturnValue({ runId: record.sdkRunId, status: Promise.reject(new Error("password=private-never-return")) });
    if (variant === "other-run") mocks.getRun.mockReturnValue({ runId: "wrun_other", status: Promise.resolve("completed") });
    if (variant === "unexpected") mocks.getRun.mockReturnValue({ runId: record.sdkRunId, status: Promise.resolve("unknown") });
    const result = await recoverDefaultResultAction({ runId, mode: "verify" });
    expect(result).toMatchObject({ ok: true, workflowNotificationPending: true, delivery: { status: "confirmed", canVerify: true } });
    expect(JSON.stringify(result)).not.toMatch(/private-never-return|private-current-hook|wrun_other|wrun_recovery/);
  });
  it("状态读取有独立两秒上限，迟到拒绝不改写已返回的确认", async () => {
    vi.useFakeTimers();
    let rejectStatus: (reason: unknown) => void = () => undefined;
    const status = new Promise<never>((_, reject) => { rejectStatus = reject; });
    mocks.getRun.mockReturnValue({ runId: record.sdkRunId, status });
    let settled = false;
    const recovery = recoverDefaultResultAction({ runId, mode: "verify" }).then((value) => { settled = true; return value; });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.getRun).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(recovery).resolves.toMatchObject({ ok: true, workflowNotificationPending: true });
    expect(vi.getTimerCount()).toBe(0);
    rejectStatus(new Error("迟到的状态读取失败"));
    await Promise.resolve();
  });
  it("没有等待入口的终态不访问引擎或虚构待通知", async () => {
    mocks.read.mockResolvedValue({ ...record, status: "confirmed", acknowledgement: "confirmed", confirmedAt: now });
    const result = await recoverDefaultResultAction({ runId, mode: "verify" });
    expect(result).toMatchObject({ ok: true, workflowNotified: false });
    expect(result).not.toHaveProperty("workflowNotificationPending");
    expect(mocks.resume).not.toHaveBeenCalled(); expect(mocks.getRun).not.toHaveBeenCalled();
  });
  it("原核对请求可在通知失败后重试，沿用同一等待入口和冻结成果", async () => {
    const saved = await mocks.read(), original = structuredClone(saved);
    mocks.resume.mockRejectedValueOnce(new Error("首次通知失败")).mockResolvedValue(undefined);
    await expect(recoverDefaultResultAction({ runId, mode: "verify" })).resolves.toMatchObject({ workflowNotificationPending: true });
    const result = await recoverDefaultResultAction({ runId, mode: "verify" });
    expect(result).toMatchObject({ ok: true, workflowNotified: true, delivery: { status: "confirmed", canRetry: false } });
    expect(result).not.toHaveProperty("workflowNotificationPending");
    expect(mocks.resume.mock.calls).toEqual([["private-current-hook", { kind: "delivery-updated" }], ["private-current-hook", { kind: "delivery-updated" }]]);
    expect(mocks.deliver.mock.calls).toEqual([[runId, DEMO_WORKSPACE_ID, true], [runId, DEMO_WORKSPACE_ID, true]]);
    expect(saved).toEqual(original);
  });
});
