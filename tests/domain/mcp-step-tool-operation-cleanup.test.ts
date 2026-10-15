import { describe, expect, it, vi } from "vitest";
import { cleanupMcpStepToolRun } from "../helpers/mcp-step-tool-operation-cleanup";

function fixture() {
  const events: string[] = [];
  let status: "running" | "cancelled" = "running";
  const owned = {
    get status() { events.push(`status:${status}`); return Promise.resolve(status); },
    cancel: vi.fn(async () => { events.push("cancel"); status = "cancelled"; }),
  };
  const handles: Array<Parameters<typeof cleanupMcpStepToolRun>[0]["handles"][number]> = [owned];
  const resources = {
    handles, pendingStartRunIds: [] as string[],
    deleteOwnedRecords: vi.fn(async () => { events.push("delete"); }),
    closeService: vi.fn(async () => { events.push("close"); }),
    restoreEnvironment: vi.fn(() => { events.push("restore"); }),
  };
  return { events, owned, resources };
}

describe("MCP写步骤验收清理（纯模拟，不连接数据库或引擎）", () => {
  it("确认自有引擎停止后才删除记录，随后关闭服务和恢复环境", async () => {
    const test = fixture();
    await cleanupMcpStepToolRun(test.resources);
    expect(test.events).toEqual(["status:running", "cancel", "status:cancelled", "delete", "close", "restore"]);
  });
  it("启动未返回句柄时处理已知句柄但保留全部记录", async () => {
    const test = fixture();
    test.resources.pendingStartRunIds.push("owned-start-not-confirmed");
    await expect(cleanupMcpStepToolRun(test.resources)).rejects.toThrow("保留数据库记录");
    expect(test.events).toEqual(["status:running", "cancel", "status:cancelled", "close", "restore"]);
    expect(test.resources.deleteOwnedRecords).not.toHaveBeenCalled();
  });
  it("取消失败仍尝试其他自有句柄，不删除记录且保留原异常", async () => {
    const test = fixture(), failure = new Error("cancel-test-only-failed");
    test.resources.handles.unshift({ status: Promise.resolve("running" as const), cancel: vi.fn(async () => { throw failure; }) });
    await expect(cleanupMcpStepToolRun(test.resources)).rejects.toMatchObject({ errors: [expect.objectContaining({ errors: [failure] })] });
    expect(test.owned.cancel).toHaveBeenCalledTimes(1);
    expect(test.resources.deleteOwnedRecords).not.toHaveBeenCalled();
    expect(test.resources.closeService).toHaveBeenCalledTimes(1);
    expect(test.resources.restoreEnvironment).toHaveBeenCalledTimes(1);
  });
  it("取消已返回但尚无终态时不能删除记录或把清理标绿", async () => {
    const test = fixture();
    test.resources.handles = [{ status: Promise.resolve("running" as const), cancel: vi.fn(async () => undefined) }];
    await expect(cleanupMcpStepToolRun(test.resources)).rejects.toThrow("未确认停止");
    expect(test.resources.deleteOwnedRecords).not.toHaveBeenCalled();
    expect(test.resources.closeService).toHaveBeenCalledTimes(1);
    expect(test.resources.restoreEnvironment).toHaveBeenCalledTimes(1);
  });
  it("删除和关闭异常仍恢复环境，全部清理异常可见", async () => {
    const test = fixture(), deletion = new Error("delete-test-only-failed"), closing = new Error("close-test-only-failed"), restoring = new Error("restore-test-only-failed");
    test.resources.deleteOwnedRecords.mockRejectedValue(deletion);
    test.resources.closeService.mockRejectedValue(closing);
    test.resources.restoreEnvironment.mockImplementation(() => { throw restoring; });
    await expect(cleanupMcpStepToolRun(test.resources)).rejects.toMatchObject({ errors: [deletion, closing, restoring] });
    expect(test.resources.restoreEnvironment).toHaveBeenCalledTimes(1);
  });
});
