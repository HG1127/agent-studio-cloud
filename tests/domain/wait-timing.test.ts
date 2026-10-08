import { describe, expect, it } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import { createWaitTiming } from "@/server/domain/runtime/wait-timing";
const now = new Date("2026-10-08T12:00:00Z");
const wait = WorkflowNode.parse({ id: "wait", title: "等待", type: "wait", wait: { mode: "event", eventKey: "ready" } }).wait!;
describe("持久等待预计时间快照", () => {
  it("未设置外部消息超时不捏造截止时间", () => { expect(createWaitTiming(wait, now)).toEqual({ mode: "event", expectedAtMs: null }); });
  it("外部消息超时、相对等待、指定时间分别保存实际配置", () => {
    expect(createWaitTiming({ ...wait, timeoutMs: 5000 }, now)).toEqual({ mode: "event", expectedAtMs: now.getTime() + 5000 });
    expect(createWaitTiming({ ...wait, mode: "delay", durationMs: 1000 }, now)).toEqual({ mode: "delay", expectedAtMs: now.getTime() + 1000 });
    expect(createWaitTiming({ ...wait, mode: "until", until: "2026-10-08T13:00:00Z" }, now)).toEqual({ mode: "until", expectedAtMs: Date.parse("2026-10-08T13:00:00Z") });
  });
  it("旧合法小数时长、已过去或超出控制台范围的指定时间不改变执行语义", () => {
    expect(createWaitTiming({ ...wait, mode: "delay", durationMs: 0.5 }, now).expectedAtMs).toBe(now.getTime());
    expect(createWaitTiming({ ...wait, mode: "until", until: "2000-01-01T00:00:00Z" }, now).expectedAtMs).toBe(Date.parse("2000-01-01T00:00:00Z"));
    expect(createWaitTiming({ ...wait, mode: "until", until: "+010000-01-01T00:00:00Z" }, now).expectedAtMs).toBe(Date.parse("+010000-01-01T00:00:00Z"));
  });
  it.each([-1, Infinity, NaN])("无效时长 %s 明确拒绝", (durationMs) => { expect(() => createWaitTiming({ ...wait, mode: "delay", durationMs }, now)).toThrow(); });
  it("无效时刻不产生可用快照", () => {
    expect(() => createWaitTiming({ ...wait, mode: "until", until: "bad" }, now)).toThrow();
    expect(() => createWaitTiming(wait, new Date("bad"))).toThrow();
  });
});
