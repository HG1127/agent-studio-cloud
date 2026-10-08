import { describe, expect, it } from "vitest";
import { RuntimeOverviewAggregate, RuntimeOverviewInput, RuntimeOverviewResult } from "@/contracts/runtime-overview";
import { presentRuntimeOverview, runtimeOverviewBounds } from "@/server/domain/runtime-overview";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const raw = { queued: "0", running: "0", waitingApproval: "0", waitingEvent: "0", oldestQueuedReceivedAt: null, oldestQueuedReceivedAgeSeconds: null, queuedTimeUnknown: "0", activeWithEndTime: "0", received: "0", receivedUnknownStatus: "0", manual: "0", schedule: "0", agentCall: "0", handoff: "0", evaluation: "0", unknownSource: "0", completed: "0", failed: "0", cancelled: "0", knownDuration: "0", unknownDuration: "0", meanDurationMs: null, p95DurationMs: null };
const input = RuntimeOverviewInput.parse({});
const summary = presentRuntimeOverview(input, runtimeOverviewBounds(input.window, new Date("2026-10-09T12:00:00Z")), RuntimeOverviewAggregate.parse(raw));
describe("只读运行统计共享契约", () => {
  it("默认窗口与 UUID 归一化，来源按既有枚举验证", () => {
    expect(RuntimeOverviewInput.parse({ agentId: id.toUpperCase(), sourceType: "agent_call" })).toEqual({ window: "24h", agentId: id, sourceType: "agent_call" });
  });
  it.each([{ window: "90d" }, { agentId: "bad" }, { sourceType: "webhook" }, { workspaceId: id }, { from: "2026-01-01" }])("拒绝未知窗口、来源和越权参数", (value) => { expect(RuntimeOverviewInput.safeParse(value).success).toBe(false); });
  it.each(["-1", "1.2", "01", "9007199254740992", "Infinity"])("计数 %s 不丢精度或静默修正", (queued) => { expect(RuntimeOverviewAggregate.safeParse({ ...raw, queued }).success).toBe(false); });
  it("响应拒绝业务正文、私有字段、错误失败率及窗口漂移", () => {
    expect(RuntimeOverviewResult.safeParse({ ok: true, summary }).success).toBe(true);
    expect(RuntimeOverviewResult.safeParse({ ok: true, summary: { ...summary, input: { private: true } } }).success).toBe(false);
    expect(RuntimeOverviewResult.safeParse({ ok: true, summary: { ...summary, filters: { ...summary.filters, window: "1h" } } }).success).toBe(false);
    expect(RuntimeOverviewResult.safeParse({ ok: true, summary: { ...summary, finished: { ...summary.finished, failureRatePercent: 0 } } }).success).toBe(false);
  });
  it("坏时间与超出微秒精度返回校验失败，不能抛转换错误或伪造年龄", () => {
    for (const stamp of ["2026-10-09T11:59:59.abcZ", "2026-10-09T11:59:59.1234567Z", "not-a-time"]) {
      expect(() => RuntimeOverviewResult.safeParse({ ok: true, summary: { ...summary, active: { ...summary.active, queued: 1, total: 1, oldestQueuedReceivedAt: stamp, oldestQueuedReceivedAgeSeconds: 0 } } })).not.toThrow();
      expect(RuntimeOverviewResult.safeParse({ ok: true, summary: { ...summary, active: { ...summary.active, queued: 1, total: 1, oldestQueuedReceivedAt: stamp, oldestQueuedReceivedAgeSeconds: 0 } } }).success).toBe(false);
    }
  });
});
