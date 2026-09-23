import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScheduleList } from "@/features/schedules/ScheduleList";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/server/actions/update-schedule-status", () => ({ updateScheduleStatusAction: async () => ({ ok: true as const }) }));

const base = {
  id: "00000000-0000-4000-8000-0000000000f4",
  agentId: "00000000-0000-4000-8000-0000000000e9",
  agentName: "定时测试助手",
  nextRunAt: "2026-09-23T01:30:00.000Z",
  lastError: null,
  consecutiveFailures: 0,
  createdAt: "2026-09-22T00:00:00.000Z",
};

describe("定时任务列表", () => {
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
    expect(screen.getByText("运行中")).toBeInTheDocument();
    expect(screen.getByText("出错")).toBeInTheDocument();
    expect(screen.getByText("最近一次失败：运行启动失败，请稍后重试")).toBeInTheDocument();
  });
});
