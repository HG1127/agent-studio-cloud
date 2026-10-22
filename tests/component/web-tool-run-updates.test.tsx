import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TraceEventView, type RunStatus } from "@/contracts/run";
import { WebToolRunUpdates } from "@/features/web-tools/WebToolRunUpdates";

const mocks = vi.hoisted(() => ({ router: { refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
const sources: TestSource[] = [];
class TestSource {
  readonly close = vi.fn();
  readonly listeners = new Map<string, EventListener[]>();
  constructor(readonly url: string) { sources.push(this); }
  addEventListener(name: string, listener: EventListener) { this.listeners.set(name, [...this.listeners.get(name) ?? [], listener]); }
  emit(name: string, data = "") { for (const listener of this.listeners.get(name) ?? []) listener(new MessageEvent(name, { data })); }
}
const run = { id: "00000000-0000-4000-8000-000000000821", status: "running" as RunStatus };
function trace(kind = "run.completed") {
  return JSON.stringify(TraceEventView.parse({ id: "00000000-0000-4000-8000-000000000822", seq: 1, nodeId: null,
    kind, title: "private-event-detail", detail: null, level: "info", at: "2026-10-09T00:00:00Z" }));
}
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); sources.length = 0; vi.stubGlobal("EventSource", TestSource); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("网页任务真实状态自动重读", () => {
  it.each(["queued", "running", "waiting_approval", "waiting_event"] as const)("%s 只连接本次任务既有流，不自动决定或重启", (status) => {
    const { container } = render(<WebToolRunUpdates run={{ ...run, status }} />);
    expect(sources).toHaveLength(1);
    expect(sources[0].url).toBe("/api/runs/" + run.id + "/events?after=0");
    expect(screen.getByRole("button", { name: "暂停本页自动更新" })).toBeVisible();
    expect(container.textContent).not.toContain(run.id);
    expect(mocks.router.refresh).not.toHaveBeenCalled();
  });
  it.each(["completed", "failed", "cancelled"] as const)("%s 不创建连接或轮询，不虚构新结果", (status) => {
    const { container } = render(<WebToolRunUpdates run={{ ...run, status }} />);
    expect(sources).toHaveLength(0); expect(vi.getTimerCount()).toBe(0);
    expect(container).toBeEmptyDOMElement();
  });
  it("暂停清理流和低频重读，恢复才连接，不取消业务任务", () => {
    render(<WebToolRunUpdates run={run} />);
    act(() => sources[0].emit("error"));
    expect(vi.getTimerCount()).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "暂停本页自动更新" }));
    expect(sources[0].close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    expect(screen.getByRole("status")).toHaveTextContent("任务仍按原状态执行");
    act(() => { sources[0].emit("trace", trace()); sources[0].emit("error"); vi.advanceTimersByTime(10000); });
    expect(mocks.router.refresh).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "恢复本页自动更新" }));
    expect(sources).toHaveLength(2); expect(sources[1].url).toBe(sources[0].url);
  });
  it("状态事件与结束通知只重读权威数据，不将事件正文或完成字样冒充页面结果", () => {
    const view = render(<WebToolRunUpdates run={run} />);
    act(() => sources[0].emit("trace", trace()));
    expect(mocks.router.refresh).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("尝试自动读取");
    expect(view.container.textContent).not.toContain("private-event-detail");
    expect(sources[0].close).not.toHaveBeenCalled();
    act(() => sources[0].emit("done", JSON.stringify({ status: "completed" })));
    expect(sources[0].close).toHaveBeenCalledOnce();
    expect(mocks.router.refresh).toHaveBeenCalledTimes(2);
    view.rerender(<WebToolRunUpdates run={{ ...run, status: "completed" }} />);
    expect(view.container).toBeEmptyDOMElement();
    expect(sources).toHaveLength(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("未知结束通知不把运行当完成，沿既有hook保留低频查询且恢复后清理", () => {
    render(<WebToolRunUpdates run={run} />);
    act(() => sources[0].emit("done", JSON.stringify({ status: "private-unknown-status" })));
    expect(screen.getByRole("status")).toHaveTextContent("尝试自动读取");
    expect(sources[0].close).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(1);
    expect(mocks.router.refresh).toHaveBeenCalledOnce();
    act(() => { vi.advanceTimersByTime(5000); sources[0].emit("open"); vi.advanceTimersByTime(10000); });
    expect(mocks.router.refresh).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
  });
  it("浏览器没有实时能力时只使用现有低频重读，暂停也清理", () => {
    vi.stubGlobal("EventSource", undefined);
    render(<WebToolRunUpdates run={run} />);
    expect(sources).toHaveLength(0); expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(5000));
    expect(mocks.router.refresh).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "暂停本页自动更新" }));
    expect(vi.getTimerCount()).toBe(0);
  });
  it("切换实际任务隔离旧连接，即使旧消息迟到也不刷新新任务", () => {
    const view = render(<WebToolRunUpdates key={run.id} run={run} />);
    fireEvent.click(screen.getByRole("button", { name: "暂停本页自动更新" }));
    const next = { ...run, id: "00000000-0000-4000-8000-000000000823" };
    view.rerender(<WebToolRunUpdates key={next.id} run={next} />);
    expect(sources).toHaveLength(2); expect(sources[1].url).toContain(next.id);
    act(() => { sources[0].emit("trace", trace()); sources[0].emit("done", '{"status":"completed"}'); });
    expect(mocks.router.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "暂停本页自动更新" })).toBeVisible();
  });
  it("卸载清理等待与重读，迟到事件没有外部页面副作用", () => {
    const view = render(<WebToolRunUpdates run={run} />);
    act(() => sources[0].emit("error"));
    view.unmount();
    expect(sources[0].close).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
    act(() => { sources[0].emit("trace", trace()); sources[0].emit("error"); vi.advanceTimersByTime(10000); });
    expect(mocks.router.refresh).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it.each([{ ...run, id: "../private-run" }, { ...run, status: "private-unknown-status" as RunStatus }])("非法标识或未知状态不创建请求，保持未知而不补成执行中", (invalid) => {
    const { container } = render(<WebToolRunUpdates run={invalid} />);
    expect(sources).toHaveLength(0); expect(vi.getTimerCount()).toBe(0);
    expect(screen.getByRole("status")).toHaveTextContent("未开启自动更新");
    expect(container.textContent).not.toMatch(/private-run|private-unknown-status/);
  });
});
