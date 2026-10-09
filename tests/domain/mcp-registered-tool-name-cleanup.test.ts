import { describe, expect, it, vi } from "vitest";
import { stopRegisteredNameTestRuns } from "../helpers/mcp-registered-tool-name-cleanup";
function handle(initial: string) {
  let status = initial;
  return { get status() { return Promise.resolve(status as "running" | "completed" | "failed" | "cancelled"); }, cancel: vi.fn(async () => { status = "cancelled"; }) };
}
describe("仅本套件句柄的清理（模拟，不启动引擎）", () => {
  it("取消活动句柄，不读取或取消未登记的其他运行", async () => {
    const owned = handle("running"), outside = handle("running");
    await stopRegisteredNameTestRuns([owned]);
    expect(owned.cancel).toHaveBeenCalledTimes(1); expect(await owned.status).toBe("cancelled");
    expect(outside.cancel).not.toHaveBeenCalled(); expect(await outside.status).toBe("running");
  });
  it.each(["completed", "failed", "cancelled"])("终态 %s 不再次取消", async (status) => {
    const owned = handle(status); await stopRegisteredNameTestRuns([owned]); expect(owned.cancel).not.toHaveBeenCalled();
  });
  it("状态首次读取失败仍尝试取消自有句柄并确认终态", async () => {
    let reads = 0;
    const owned = { get status() { return ++reads === 1 ? Promise.reject(new Error("读取失败")) : Promise.resolve("cancelled" as const); }, cancel: vi.fn(async () => undefined) };
    await stopRegisteredNameTestRuns([owned]); expect(owned.cancel).toHaveBeenCalledTimes(1);
  });
  it("一个取消失败也尝试其他自有句柄，并显式阻止后续数据删除", async () => {
    const failed = { status: Promise.resolve("running" as const), cancel: vi.fn(async () => { throw new Error("取消失败"); }) };
    const other = handle("running"), deleteRows = vi.fn();
    await expect((async () => { await stopRegisteredNameTestRuns([failed, other]); deleteRows(); })()).rejects.toThrow("保留数据库记录");
    expect(other.cancel).toHaveBeenCalledTimes(1); expect(deleteRows).not.toHaveBeenCalled();
  });
  it("取消返回但仍活动时显式失败，不允许把清理标绿", async () => {
    const owned = { status: Promise.resolve("running" as const), cancel: vi.fn(async () => undefined) };
    await expect(stopRegisteredNameTestRuns([owned])).rejects.toThrow("清理失败");
  });
});

it("启动未返回句柄时处理已知自有句柄但不删除尚未知引擎关联的数据", async () => {
  const owned = handle("running"), deleteRows = vi.fn();
  await expect((async () => {
    await stopRegisteredNameTestRuns([owned], ["owned-db-run-without-handle"]);
    deleteRows();
  })()).rejects.toThrow("启动尚未返回引擎句柄，保留数据库记录");
  expect(owned.cancel).toHaveBeenCalledTimes(1);
  expect(deleteRows).not.toHaveBeenCalled();
});
