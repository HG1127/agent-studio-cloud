import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), deliver: vi.fn(), resume: vi.fn() }));
vi.mock("@/server/services/default-result-delivery", () => ({ readDefaultResultDelivery: mocks.read, deliverDefaultResult: mocks.deliver }));
vi.mock("workflow/api", () => ({ resumeHook: mocks.resume }));
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
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());
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
    expect(JSON.stringify(result)).not.toMatch(/private-current-hook|step_one|wrun_recovery|frameHash|answer/);
  });
  it("早到通知失败保留真实送达，不能把通知失败当发送失败", async () => {
    mocks.read.mockResolvedValue({ ...record, status: "confirmed", acknowledgement: "confirmed", confirmedAt: now, waitingHookToken: "private-hook", waitingHookStepId: "step_one" });
    mocks.resume.mockRejectedValue(new Error("hook尚未注册"));
    await expect(recoverDefaultResultAction({ runId, mode: "retry" })).resolves.toMatchObject({ ok: true, workflowNotified: false, delivery: { status: "confirmed" } });
  });
  it("永久错误回执安全且不可自动重试", async () => {
    mocks.deliver.mockRejectedValue(new FatalError("内部详情"));
    expect(await recoverDefaultResultAction({ runId, mode: "retry" })).toMatchObject({ ok: false, retryable: false });
  });
});
