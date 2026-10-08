import { describe, expect, it } from "vitest";
import { RuntimeOverviewAggregate, RuntimeOverviewInput, RuntimeOverviewWindow } from "@/contracts/runtime-overview";
import { presentRuntimeOverview, runtimeOverviewBounds } from "@/server/domain/runtime-overview";
const now = new Date("2026-10-09T12:00:00Z");
const row = RuntimeOverviewAggregate.parse({ queued: "0", running: "0", waitingApproval: "0", waitingEvent: "0", oldestQueuedReceivedAt: null, oldestQueuedReceivedAgeSeconds: null, queuedTimeUnknown: "0", activeWithEndTime: "0",
  received: "0", receivedUnknownStatus: "0", manual: "0", schedule: "0", agentCall: "0", handoff: "0", evaluation: "0", unknownSource: "0",
  completed: "0", failed: "0", cancelled: "0", knownDuration: "0", unknownDuration: "0", meanDurationMs: null, p95DurationMs: null });
const input = RuntimeOverviewInput.parse({});
const bounds = runtimeOverviewBounds(input.window, now);
describe("运行监控统计口径", () => {
  it.each(RuntimeOverviewWindow.options)("%s 窗口使用传入检查时间，不读系统时钟", (window) => {
    const result = runtimeOverviewBounds(window, now);
    expect(result.until).toBe(now.toISOString());
    expect(Date.parse(result.from)).toBeLessThan(now.getTime());
  });
  it("零样本与全部取消不虚报零失败率或零耗时", () => {
    expect(presentRuntimeOverview(input, bounds, row)).toMatchObject({ finished: { total: 0, failureRatePercent: null, meanDurationMs: null, p95DurationMs: null } });
    expect(presentRuntimeOverview(input, bounds, { ...row, cancelled: 3, unknownDuration: 3 })).toMatchObject({ finished: { total: 3, failureRatePercent: null } });
  });
  it("失败率仅使用同一结束窗口内成功与失败样本，不含取消或新接收任务", () => {
    const result = presentRuntimeOverview(input, bounds, { ...row, received: 50, manual: 50, completed: 2, failed: 1, cancelled: 100, knownDuration: 2, unknownDuration: 101, meanDurationMs: 1500, p95DurationMs: 1950 });
    expect(result).toMatchObject({ received: { total: 50 }, finished: { total: 103, failureRatePercent: 33.33, knownDurationCount: 2, unknownDurationCount: 101 } });
  });
  it("当前积压不受接收时间窗口限制，定时与消息等待不混称外部消息", () => {
    expect(presentRuntimeOverview(input, bounds, { ...row, queued: 2, running: 1, waitingApproval: 3, waitingEvent: 4, queuedTimeUnknown: 1, oldestQueuedReceivedAt: "2026-10-01T12:00:00.000000Z", oldestQueuedReceivedAgeSeconds: 8 * 86400 })).toMatchObject({ active: { total: 10, queuedTimeUnknown: 1, oldestQueuedReceivedAgeSeconds: 8 * 86400 } });
  });
  it("微秒边界保留不足一秒的实际年龄，不截断后误报一秒", () => {
    const result = presentRuntimeOverview(input, bounds, { ...row, queued: 1, oldestQueuedReceivedAt: "2026-10-09T11:59:59.000123Z", oldestQueuedReceivedAgeSeconds: 0 });
    expect(result.active.oldestQueuedReceivedAgeSeconds).toBe(0);
    expect(() => presentRuntimeOverview(input, bounds, { ...row, queued: 1, oldestQueuedReceivedAt: "2026-10-09T11:59:59.000123Z", oldestQueuedReceivedAgeSeconds: 1 })).toThrow();
  });
  it("保留未知来源与未知状态，不偷偷转为手动或成功", () => {
    expect(presentRuntimeOverview(input, bounds, { ...row, received: 1, unknownSource: 1, receivedUnknownStatus: 1 })).toMatchObject({ received: { unknownStatus: 1, bySource: { manual: 0, unknown: 1 } } });
  });
  it("非法时间、计数不一致和不完整耗时拒绝，不返回部分成功", () => {
    expect(() => runtimeOverviewBounds("24h", new Date("bad"))).toThrow();
    expect(() => presentRuntimeOverview(input, bounds, { ...row, received: 2, manual: 1 })).toThrow();
    expect(() => presentRuntimeOverview(input, bounds, { ...row, completed: 1, knownDuration: 1, meanDurationMs: null })).toThrow();
    expect(() => presentRuntimeOverview(input, bounds, { ...row, queued: 1 })).toThrow();
  });
  it("默认工作域与筛选经过共享契约，纯展示不修改输入", () => {
    const original = structuredClone(row);
    expect(presentRuntimeOverview(input, bounds, row).filters).toEqual({ window: "24h", agentId: null, sourceType: null });
    expect(row).toEqual(original);
  });
});
