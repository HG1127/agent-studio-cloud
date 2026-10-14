import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TraceEventView } from "@/contracts/run";
import { useRunStream } from "@/features/runs/use-run-stream";

const mocks = vi.hoisted(() => {
  const refresh = vi.fn();
  return { refresh, router: { refresh } };
});
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));

const sources: TestEventSource[] = [];
class TestEventSource {
  readonly listeners = new Map<string, EventListener[]>();
  readonly close = vi.fn();
  constructor(readonly url: string) { sources.push(this); }
  addEventListener(name: string, listener: EventListener) {
    this.listeners.set(name, [...this.listeners.get(name) ?? [], listener]);
  }
  emit(name: string, data = "") {
    const event = new MessageEvent(name, { data });
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }
}
const runId = "00000000-0000-4000-8000-000000000081";
const secondRunId = "00000000-0000-4000-8000-000000000082";
const empty: TraceEventView[] = [];
const trace = (seq: number, kind = "step.started") => TraceEventView.parse({
  id: "00000000-0000-4000-8000-" + String(seq).padStart(12, "0"), seq, nodeId: null, kind,
  level: "info", title: "真实保存事件", detail: null, at: "2026-10-09T00:00:00.000Z",
});

describe("运行实时轨迹与权威状态重读", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    sources.length = 0;
    vi.stubGlobal("EventSource", TestEventSource);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("从已有序号连接并按实际序号去重合并，一般步骤事件不刷新状态", () => {
    const initial = [trace(4)];
    const { result } = renderHook(() => useRunStream(runId, initial, true));
    expect(sources[0].url).toBe(`/api/runs/${runId}/events?after=4`);
    act(() => {
      sources[0].emit("trace", JSON.stringify(trace(6)));
      sources[0].emit("trace", JSON.stringify(trace(5)));
      sources[0].emit("trace", JSON.stringify(trace(5)));
    });
    expect(result.current.map((event) => event.seq)).toEqual([4, 5, 6]);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it.each(["run.started", "run.completed", "run.failed", "run.cancelled", "approval.requested", "wait.started", "run.resumed"])(
    "%s 实际状态事件触发服务端重读，不等待结束通知", (kind) => {
      const { result } = renderHook(() => useRunStream(runId, empty, true));
      act(() => { sources[0].emit("trace", JSON.stringify(trace(1, kind))); });
      expect(mocks.refresh).toHaveBeenCalledOnce();
      expect(result.current).toEqual([trace(1, kind)]);
      expect(sources[0].close).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("完成轨迹只重读权威状态，合法结束通知才关闭流且重复通知不重复刷新", () => {
    renderHook(() => useRunStream(runId, empty, true));
    act(() => { sources[0].emit("trace", JSON.stringify(trace(1, "run.completed"))); });
    expect(sources[0].close).not.toHaveBeenCalled();
    act(() => {
      sources[0].emit("done", JSON.stringify({ status: "completed" }));
      sources[0].emit("done", JSON.stringify({ status: "completed" }));
      sources[0].emit("error");
    });
    expect(sources[0].close).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("坏消息不写入轨迹，也不按任意文字猜测状态", () => {
    const { result } = renderHook(() => useRunStream(runId, empty, true));
    act(() => {
      sources[0].emit("trace", "not-json");
      sources[0].emit("trace", JSON.stringify({ kind: "run.completed", title: "已完成" }));
    });
    expect(result.current).toEqual([]);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("重放初始已读状态事件不重复重读，新状态事件仍立即触发读取", () => {
    const initial = [trace(1, "run.started")];
    const { result } = renderHook(() => useRunStream(runId, initial, true));
    act(() => { sources[0].emit("trace", JSON.stringify(initial[0])); });
    expect(mocks.refresh).not.toHaveBeenCalled();
    act(() => { sources[0].emit("trace", JSON.stringify(trace(2, "run.completed"))); });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(result.current.map((event) => event.seq)).toEqual([1, 2]);
  });

  it("断流仅保留现有低频重读，连接恢复后停止，卸载清理连接", () => {
    const { unmount } = renderHook(() => useRunStream(runId, empty, true));
    act(() => { sources[0].emit("error"); sources[0].emit("error"); });
    expect(vi.getTimerCount()).toBe(1);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    act(() => { sources[0].emit("open"); vi.advanceTimersByTime(10000); });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    unmount();
    expect(sources[0].close).toHaveBeenCalledOnce();
  });

  it("不在进行中时只展示实际已读轨迹，不创建连接", () => {
    const initial = [trace(1, "run.completed")];
    const { result } = renderHook(() => useRunStream(runId, initial, false));
    expect(sources).toHaveLength(0);
    expect(result.current).toEqual(initial);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("切换任务清理旧连接，不让前一个任务的事件混入当前记录", () => {
    const { result, rerender } = renderHook(({ id }) => useRunStream(id, empty, true), { initialProps: { id: runId } });
    act(() => { sources[0].emit("trace", JSON.stringify(trace(1))); });
    rerender({ id: secondRunId });
    expect(sources[0].close).toHaveBeenCalledOnce();
    expect(sources[1].url).toContain(secondRunId);
    expect(result.current).toEqual([]);
  });

  it("服务端错误通知保留恢复途径，不误当终态关闭", () => {
    renderHook(() => useRunStream(runId, empty, true));
    act(() => { sources[0].emit("done", JSON.stringify({ status: "error" })); });
    expect(sources[0].close).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);
  });

  it("卸载后延迟到达的轨迹、结束与错误不刷新其他页面或启动计时器", () => {
    const { result, unmount } = renderHook(() => useRunStream(runId, empty, true));
    unmount();
    act(() => {
      sources[0].emit("trace", JSON.stringify(trace(1, "run.completed")));
      sources[0].emit("done", JSON.stringify({ status: "completed" }));
      sources[0].emit("error");
      sources[0].emit("open");
    });
    expect(result.current).toEqual([]);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
