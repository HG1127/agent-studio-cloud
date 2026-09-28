import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScheduleList, nextRunLabel, orderSchedules } from "@/features/schedules/ScheduleList";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), update: vi.fn(async () => ({ ok: true as const })) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/server/actions/update-schedule-status", () => ({ updateScheduleStatusAction: mocks.update }));

const base = {
  id: "00000000-0000-4000-8000-0000000000f4",
  agentId: "00000000-0000-4000-8000-0000000000e9",
  agentName: "定时测试助手",
  nextRunAt: "2026-09-23T01:30:00.000Z",
  lastError: null,
  consecutiveFailures: 0,
  createdAt: "2026-09-22T00:00:00.000Z",
};

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("定时任务列表", () => {
  it("需要处理的任务置顶，随后按最近执行时间排列，且不修改服务端原数组", () => {
    const late = { ...base, id: "late", status: "active" as const, nextRunAt: "2026-09-24T01:30:00.000Z", spec: { kind: "interval" as const, minutes: 5 } };
    const paused = { ...base, id: "paused", status: "paused" as const, spec: { kind: "interval" as const, minutes: 5 } };
    const soon = { ...base, id: "soon", status: "active" as const, spec: { kind: "interval" as const, minutes: 5 } };
    const failed = { ...base, id: "failed", status: "error" as const, spec: { kind: "interval" as const, minutes: 5 } };
    const source = [late, paused, soon, failed];
    expect(orderSchedules(source).map((item) => item.id)).toEqual(["failed", "soon", "late", "paused"]);
    expect(source.map((item) => item.id)).toEqual(["late", "paused", "soon", "failed"]);
  });

  it("渲染频率摘要与状态；出错行显示最近失败原因", () => {
    render(
      <ScheduleList
        initial={[
          { ...base, status: "active", spec: { kind: "interval", minutes: 5 } },
          { ...base, id: "00000000-0000-4000-8000-0000000000f6", status: "error", spec: { kind: "daily", times: ["09:30"] }, lastError: "运行启动失败，请稍后重试" },
        ]}
      />,
    );
    expect(screen.getByText(/每 5 分钟/)).toBeInTheDocument();
    expect(screen.getByText(/每天 09:30/)).toBeInTheDocument();
    expect(screen.getAllByText("已启用").length).toBeGreaterThan(0);
    expect(screen.getAllByText("需要处理").length).toBeGreaterThan(0);
    expect(screen.getByText("运行启动失败，请稍后重试")).toBeInTheDocument();
    expect(screen.queryByText("连续失败 0 次", { exact: false })).not.toBeInTheDocument();
    expect(screen.getByText("处理后再计算")).toBeInTheDocument();
  });

  it("按需要处理筛选，并为单条任务提供真实自动运行记录入口", () => {
    render(<ScheduleList initial={[
      { ...base, status: "active", spec: { kind: "interval", minutes: 5 } },
      { ...base, id: "00000000-0000-4000-8000-0000000000f6", status: "error", spec: { kind: "daily", times: ["09:30"] }, lastError: "运行启动失败" },
    ]} />);
    fireEvent.click(screen.getByRole("tab", { name: /需要处理/ }));
    expect(screen.queryByText(/每 5 分钟/)).not.toBeInTheDocument();
    expect(screen.getByText(/每天 09:30/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /查看此助手的自动运行记录/ })).toHaveAttribute("href", `/runs?source=schedule&agent=${base.agentId}`);
    expect(screen.getByRole("link", { name: "查看助手版本" })).toHaveAttribute("href", `/agents/${base.agentId}`);
  });

  it("已暂停任务可单独筛选，旧下次时间不会被当成即将运行", () => {
    const paused = { ...base, id: "00000000-0000-4000-8000-0000000000f7", status: "paused" as const, spec: { kind: "daily" as const, times: ["18:00"] } };
    render(<ScheduleList initial={[{ ...base, status: "active", spec: { kind: "interval", minutes: 5 } }, paused]} />);
    fireEvent.click(screen.getByRole("tab", { name: /已暂停/ }));
    expect(screen.getByText("每天 18:00")).toBeInTheDocument();
    expect(screen.queryByText(/每 5 分钟/)).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /已暂停/ })).toHaveAttribute("aria-selected", "true");
    expect(nextRunLabel(paused)).toBe("已暂停");
  });

  it("成功暂停后给出反馈，列表可手动读取最新状态", async () => {
    render(<ScheduleList initial={[{ ...base, status: "active", spec: { kind: "interval", minutes: 5 } }]} />);
    fireEvent.click(screen.getByRole("button", { name: "暂停" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(base.id, "paused"));
    expect(await screen.findByRole("status")).toHaveTextContent("已暂停自动运行");
    fireEvent.click(await screen.findByRole("button", { name: "重新读取状态" }));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("状态响应丢失时要求核对，不把未知结果说成失败", async () => {
    mocks.update.mockRejectedValueOnce(new Error("offline"));
    render(<ScheduleList initial={[{ ...base, status: "active", spec: { kind: "interval", minutes: 5 } }]} />);
    fireEvent.click(screen.getByRole("button", { name: "暂停" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法确认任务状态是否已改变");
    fireEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "刷新列表核对" }));
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("归档最后一条任务后仍展示成功反馈", async () => {
    const { rerender } = render(<ScheduleList initial={[{ ...base, status: "active", spec: { kind: "interval", minutes: 5 } }]} />);
    fireEvent.click(screen.getByRole("button", { name: "归档" }));
    fireEvent.click(screen.getByRole("button", { name: "确认归档" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(base.id, "archived"));
    rerender(<ScheduleList initial={[]} />);
    expect(screen.getByRole("status")).toHaveTextContent("定时任务已归档");
  });

  it("页面隐藏时不反复查询定时状态", () => {
    vi.useFakeTimers();
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    render(<ScheduleList initial={[{ ...base, status: "active", spec: { kind: "interval", minutes: 5 } }]} />);
    act(() => vi.advanceTimersByTime(45_000));
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
