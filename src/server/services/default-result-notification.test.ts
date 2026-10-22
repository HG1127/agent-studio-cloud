import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  run: {} as Record<string, unknown>, delivery: {} as Record<string, unknown>, sdkStatus: "running",
  resume: vi.fn(), getRun: vi.fn(),
  update: vi.fn(() => { throw new Error("终态核对不能改写记录"); }),
  transaction: vi.fn(() => { throw new Error("终态核对不能建立发送事务"); }),
  observe: vi.fn(() => { throw new Error("终态核对不能重读成果流"); }),
  write: vi.fn(() => { throw new Error("终态核对不能再次发送成果"); }),
  close: vi.fn(() => { throw new Error("终态核对不能再次关闭成果流"); }),
}));
vi.mock("@/lib/db", () => ({ db: {
  select: () => {
    let table: Record<string, unknown>;
    const query = {
      from: (value: typeof table) => { table = value; return query; }, where: () => query,
      limit: async () => [structuredClone("frozen" in table ? mocks.delivery : mocks.run)],
    };
    return query;
  }, update: mocks.update, transaction: mocks.transaction,
} }));
vi.mock("workflow/api", () => ({ resumeHook: mocks.resume, getRun: mocks.getRun }));
vi.mock("@/server/services/default-result-stream-sdk", () => ({
  observeDefaultResultStream: mocks.observe, writeDefaultResultStreamFrame: mocks.write, closeDefaultResultStream: mocks.close,
  DefaultResultStreamSdkError: class extends Error {},
}));

import { GET, POST } from "@/app/api/runs/[runId]/default-result/route";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { freezeDefaultResultFrame } from "@/server/domain/runtime/default-result-stream";

const runId = "11111111-1111-4111-8111-111111111111", sdkRunId = "wrun_control_notification";
const now = new Date("2026-10-12T00:00:00.000Z"), result = { amount: 0, approved: false };
const frozen = freezeDefaultResultFrame({ runId, status: "completed", outcome: "completed", finishedAt: now.toISOString(), result });
const context = { params: Promise.resolve({ runId }) }, url = `http://localhost/api/runs/${runId}/default-result`;
function request() {
  return new Request(url, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: '{"mode":"verify"}' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sdkStatus = "running";
  mocks.getRun.mockReset().mockImplementation((runId: string) => ({ runId, status: Promise.resolve(mocks.sdkStatus) }));
  mocks.resume.mockReset().mockResolvedValue(undefined);
  mocks.run = { id: runId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, status: "completed", parentRunId: null,
    sourceType: "manual", workflowRunId: sdkRunId, defaultResultTrackingVersion: "sdk5-v1", finishedAt: now, result };
  mocks.delivery = { runId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, sdkRunId, frozen,
    status: "confirmed", writeAttempts: 1, operation: "close", operationToken: "private-operation",
    waitingHookToken: "private-current-hook", waitingHookStepId: "step_one", acknowledgement: "confirmed", producerSettled: true,
    error: null, createdAt: now, updatedAt: now, confirmedAt: now };
});

function expectNoBusinessOrStorageMutation(original: { run: Record<string, unknown>; delivery: Record<string, unknown> }) {
  expect({ run: mocks.run, delivery: mocks.delivery }).toEqual(original);
  for (const call of [mocks.update, mocks.transaction, mocks.observe, mocks.write, mocks.close]) expect(call).not.toHaveBeenCalled();
}

describe("成果通知的HTTP处理器→真实动作→真实服务接线（数据库与SDK替身，非实际Workflow）", () => {
  it("已保存等待入口的根仍运行时，通知失败明确202，刷新与重试仍可只发送控制消息", async () => {
    const original = structuredClone({ run: mocks.run, delivery: mocks.delivery });
    mocks.resume.mockRejectedValueOnce(new Error("控制消息传输500"));
    const pending = await POST(request(), context);
    expect(pending.status).toBe(202); expect(pending.headers.get("retry-after")).toBe("2");
    expect(await pending.json()).toMatchObject({ ok: true, workflowNotified: false, workflowNotificationPending: true,
      delivery: { status: "confirmed", canRetry: false, canVerify: true } });
    expect(mocks.getRun).toHaveBeenCalledWith(sdkRunId);
    const refreshed = await GET(new Request(url), context);
    expect(refreshed.status).toBe(200);
    expect(await refreshed.json()).toMatchObject({ delivery: { status: "confirmed", canRetry: false, canVerify: true } });
    const retried = await POST(request(), context);
    expect(retried.status).toBe(200); expect(retried.headers.get("retry-after")).toBeNull();
    const response = await retried.json();
    expect(response).toMatchObject({ ok: true, workflowNotified: true, delivery: { status: "confirmed", canRetry: false } });
    expect(response).not.toHaveProperty("workflowNotificationPending");
    expect(mocks.resume.mock.calls).toEqual([["private-current-hook", { kind: "delivery-updated" }], ["private-current-hook", { kind: "delivery-updated" }]]);
    expect(JSON.stringify(response)).not.toMatch(/private-|wrun_|frameHash|approved|step_one/);
    expectNoBusinessOrStorageMutation(original);
  });
  it("通知ACK丢失但公开根已结束时保留送达且不要求无穷重试", async () => {
    const original = structuredClone({ run: mocks.run, delivery: mocks.delivery });
    mocks.sdkStatus = "completed";
    mocks.resume.mockRejectedValue(new Error("已受理但响应丢失"));
    const response = await POST(request(), context), body = await response.json();
    expect(response.status).toBe(200); expect(response.headers.get("retry-after")).toBeNull();
    expect(body).toMatchObject({ ok: true, workflowNotified: false, delivery: { status: "confirmed" } });
    expect(body).not.toHaveProperty("workflowNotificationPending");
    expectNoBusinessOrStorageMutation(original);
  });
  it("失败投递的通知与状态读取都异常时仍可核对，不能把失败投递或业务成果改成成功", async () => {
    mocks.delivery = { ...mocks.delivery, status: "failed", error: "成果流核对失败", confirmedAt: null };
    const original = structuredClone({ run: mocks.run, delivery: mocks.delivery });
    mocks.resume.mockRejectedValue(new Error("password=private-response"));
    mocks.getRun.mockImplementation(() => { throw new Error("password=private-status"); });
    const response = await POST(request(), context), body = await response.json();
    expect(response.status).toBe(202); expect(response.headers.get("retry-after")).toBe("2");
    expect(body).toMatchObject({ ok: true, workflowNotificationPending: true, workflowNotified: false,
      delivery: { status: "failed", canRetry: false, canVerify: true } });
    expect(JSON.stringify(body)).not.toMatch(/password|private-|wrun_|frameHash|approved|step_one/);
    expectNoBusinessOrStorageMutation(original);
  });
});
