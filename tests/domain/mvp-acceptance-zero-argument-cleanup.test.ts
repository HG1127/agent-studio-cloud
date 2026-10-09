import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupZeroArgumentReadTemplate, type ZeroArgumentReadContext } from "../helpers/mvp-acceptance-zero-argument-read";

const { deleteOwnedRows } = vi.hoisted(() => ({ deleteOwnedRows: vi.fn() }));
vi.mock("../helpers/mvp-acceptance-template", () => ({
  cleanupMvpAcceptanceTemplate: deleteOwnedRows,
  assertMvpAcceptanceIsolatedDb: vi.fn(),
  prepareMvpAcceptanceTemplate: vi.fn(),
}));
beforeEach(() => { deleteOwnedRows.mockReset().mockResolvedValue(undefined); });
afterEach(() => { vi.unstubAllEnvs(); });

function fixture() {
  const environmentBefore = process.env.MVP_ZERO_CLEANUP_PROBE;
  vi.stubEnv("MVP_ZERO_CLEANUP_PROBE", "cleanup-test-only");
  const resources = {
    workflowHandles: [] as ZeroArgumentReadContext["workflowHandles"], pendingStartRunIds: new Set<string>(),
    tools: { close: vi.fn(async () => undefined) }, model: { close: vi.fn(async () => undefined) }, read: { close: vi.fn(async () => undefined) },
  };
  return { context: resources as unknown as ZeroArgumentReadContext, resources, environmentBefore };
}
function ownedHandle(events: string[] = []) {
  let status: "running" | "cancelled" = "running";
  return {
    get status() { events.push(`status:${status}`); return Promise.resolve(status); },
    cancel: vi.fn(async () => { events.push("cancel"); status = "cancelled"; }),
  } as unknown as ZeroArgumentReadContext["workflowHandles"][number];
}
function closedAndRestored(test: ReturnType<typeof fixture>) {
  expect(test.resources.tools.close).toHaveBeenCalledTimes(1);
  expect(test.resources.model.close).toHaveBeenCalledTimes(1);
  expect(test.resources.read.close).toHaveBeenCalledTimes(1);
  expect(process.env.MVP_ZERO_CLEANUP_PROBE).toBe(test.environmentBefore);
}

describe("零参数验收清理顺序与资源释放（纯模拟，不启动数据库或引擎）", () => {
  it("确认全部自有句柄终止后才删库，随后关闭服务并恢复环境", async () => {
    const test = fixture(), events: string[] = [];
    test.resources.workflowHandles.push(ownedHandle(events));
    deleteOwnedRows.mockImplementation(async () => { events.push("delete"); });
    await cleanupZeroArgumentReadTemplate(test.context);
    expect(events).toEqual(["status:running", "cancel", "status:cancelled", "delete"]);
    expect(deleteOwnedRows).toHaveBeenCalledExactlyOnceWith(test.context);
    closedAndRestored(test);
  });

  it("启动或关联尚未确认时先停止已知句柄、保留记录，同时关闭所有服务", async () => {
    const test = fixture(), events: string[] = [];
    test.resources.workflowHandles.push(ownedHandle(events));
    test.resources.pendingStartRunIds.add("request:unknown-start-test-only");
    await expect(cleanupZeroArgumentReadTemplate(test.context)).rejects.toThrow("保留数据库记录");
    expect(events).toEqual(["status:running", "cancel", "status:cancelled"]);
    expect(deleteOwnedRows).not.toHaveBeenCalled();
    closedAndRestored(test);
  });

  it("取消失败仍处理其他自有句柄，保留数据库并保留原异常", async () => {
    const test = fixture(), events: string[] = [], failure = new Error("cancel-test-only-failed");
    const failed = { status: Promise.resolve("running"), cancel: vi.fn(async () => { throw failure; }) };
    test.resources.workflowHandles.push(failed as unknown as ZeroArgumentReadContext["workflowHandles"][number], ownedHandle(events));
    await expect(cleanupZeroArgumentReadTemplate(test.context)).rejects.toMatchObject({ errors: [expect.objectContaining({ errors: [failure] })] });
    expect(events).toEqual(["status:running", "cancel", "status:cancelled"]);
    expect(deleteOwnedRows).not.toHaveBeenCalled();
    closedAndRestored(test);
  });

  it("一个假服务关闭失败也尝试其余服务并恢复环境，关闭错误不吞掉", async () => {
    const test = fixture(), failure = new Error("close-test-only-failed");
    test.resources.tools.close.mockRejectedValue(failure);
    await expect(cleanupZeroArgumentReadTemplate(test.context)).rejects.toMatchObject({ errors: [expect.objectContaining({ errors: [failure] })] });
    expect(deleteOwnedRows).toHaveBeenCalledExactlyOnceWith(test.context);
    closedAndRestored(test);
  });

  it("删库异常仍释放全部资源并恢复环境，原异常继续抛出", async () => {
    const test = fixture(), failure = new Error("delete-test-only-failed");
    deleteOwnedRows.mockRejectedValue(failure);
    await expect(cleanupZeroArgumentReadTemplate(test.context)).rejects.toMatchObject({ errors: [failure] });
    closedAndRestored(test);
  });
});
