// TraceTimeline 组件测试：静态三行渲染 + SSE 增量上屏（去重）+ 等待确认即刷新 + done 后断开并刷新 + 非实时不建连。
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TraceTimeline } from "@/features/runs/TraceTimeline";
import type { TraceEventView } from "@/contracts/run";

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const RUN_ID = "3f0d2c9e-8a7b-4c1d-9e2f-1a2b3c4d5e6f";

function makeEvent(overrides: Partial<TraceEventView>): TraceEventView {
  return {
    id: "b2c3d4e5-0000-4000-8000-0000000000b1",
    seq: 1,
    nodeId: null,
    kind: "run.started",
    level: "info",
    title: "流程开始执行",
    detail: null,
    at: "2026-09-21T08:30:00.000Z",
    ...overrides,
  };
}

const EVENTS: TraceEventView[] = [
  makeEvent({ id: "b2c3d4e5-0000-4000-8000-0000000000b1", seq: 1, kind: "run.started", title: "流程开始执行" }),
  makeEvent({
    id: "b2c3d4e5-0000-4000-8000-0000000000b2",
    seq: 2,
    nodeId: "step_1",
    kind: "step.started",
    title: "开始「分析投诉原因」",
    detail: "读取任务输入与上游步骤成果",
  }),
  makeEvent({
    id: "b2c3d4e5-0000-4000-8000-0000000000b3",
    seq: 3,
    nodeId: "step_1",
    kind: "step.succeeded",
    title: "步骤「分析投诉原因」完成",
  }),
];

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  closed = false;
  listeners = new Map<string, Array<(event: { data: string }) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, callback: (event: { data: string }) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(callback);
    this.listeners.set(type, list);
  }
  emit(type: string, data: unknown) {
    for (const callback of this.listeners.get(type) ?? []) callback({ data: JSON.stringify(data) });
  }
  close() {
    this.closed = true;
  }
}

describe("TraceTimeline", () => {
  afterEach(() => {
    delete (globalThis as { EventSource?: unknown }).EventSource;
    FakeEventSource.instances = [];
    refreshMock.mockReset();
  });

  it("传入三条事件渲染三行（标题与详情按序可见）", () => {
    render(<TraceTimeline runId={RUN_ID} initialEvents={EVENTS} live={false} />);
    expect(screen.getByText("流程开始执行")).toBeInTheDocument();
    expect(screen.getByText("开始「分析投诉原因」")).toBeInTheDocument();
    expect(screen.getByText("步骤「分析投诉原因」完成")).toBeInTheDocument();
    expect(screen.getByText("读取任务输入与上游步骤成果")).toBeInTheDocument();
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it("实时模式建立连接且收到轨迹事件后增量上屏、重放事件不重复", () => {
    (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
    render(<TraceTimeline runId={RUN_ID} initialEvents={EVENTS} live />);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe(`/api/runs/${RUN_ID}/events`);

    const source = FakeEventSource.instances[0];
    // 服务端游标从 0 起会重放既有三条，客户端需按序号去重
    act(() => {
      for (const event of EVENTS) source.emit("trace", event);
      source.emit("trace", {
        id: "b2c3d4e5-0000-4000-8000-0000000000b4",
        seq: 4,
        nodeId: "step_2",
        kind: "step.started",
        level: "info",
        title: "开始「生成回复方案」",
        detail: null,
        at: "2026-09-21T08:30:06.000Z",
      });
    });
    expect(screen.getByText("开始「生成回复方案」")).toBeInTheDocument();
    expect(screen.getAllByText("流程开始执行")).toHaveLength(1);
    expect(screen.getAllByText(/开始「分析投诉原因」|步骤「分析投诉原因」完成|流程开始执行|开始「生成回复方案」/)).toHaveLength(4);
    // 普通轨迹不触发页面刷新，刷新只由等待确认/完成信号驱动
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("收到等待确认轨迹事件后刷新页面（状态卡与审批面板由服务端渲染）", () => {
    (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
    render(<TraceTimeline runId={RUN_ID} initialEvents={EVENTS} live />);
    const source = FakeEventSource.instances[0];
    act(() => {
      source.emit("trace", {
        id: "b2c3d4e5-0000-4000-8000-0000000000b4",
        seq: 4,
        nodeId: "step_2",
        kind: "approval.requested",
        level: "info",
        title: "等待「负责人确认发送内容」确认",
        detail: null,
        at: "2026-09-21T08:30:08.000Z",
      });
    });
    expect(screen.getByText("等待「负责人确认发送内容」确认")).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("收到完成事件后断开连接并刷新页面", async () => {
    (globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
    render(<TraceTimeline runId={RUN_ID} initialEvents={EVENTS} live />);
    const source = FakeEventSource.instances[0];
    source.emit("done", { status: "completed" });
    await waitFor(() => {
      expect(source.closed).toBe(true);
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });
  });

  it("轨迹为空时显示空态提示", () => {
    render(<TraceTimeline runId={RUN_ID} initialEvents={[]} live={false} />);
    expect(screen.getByText("暂无执行轨迹")).toBeInTheDocument();
  });
});
