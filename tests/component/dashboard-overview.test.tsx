import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardOverview } from "@/features/dashboard/DashboardOverview";

describe("工作台总览", () => {
  it("展示关键数字、待确认入口和最近运行", () => {
    render(<DashboardOverview summary={{
      activeAgents: 4,
      publishedAgents: 3,
      indexedSources: 8,
      activeRuns: 2,
      pendingApprovals: 1,
      pendingEvents: 1,
      runsLast24h: 12,
      failuresLast24h: 2,
    }} recentRuns={[{
      id: "00000000-0000-4000-8000-000000000001",
      agentId: "00000000-0000-4000-8000-000000000002",
      agentName: "客服助手",
      version: 2,
      status: "waiting_approval",
      sourceType: "manual",
      agentArchived: false,
      startedAt: "2026-09-24T00:00:00.000Z",
      finishedAt: null,
    }]} recentAgents={[{
      id: "00000000-0000-4000-8000-000000000003",
      name: "订单核对助手",
      description: "核对异常订单并说明差异",
      status: "draft",
      versionCount: 2,
      archivedAt: null,
      updatedAt: "2026-09-24T00:00:00.000Z",
    }]} />);
    expect(screen.getByRole("link", { name: /在用助手 4 3 个已发布/ })).toHaveAttribute("href", "/agents");
    expect(screen.getByRole("link", { name: /已就绪资料 8/ })).toHaveAttribute("href", "/knowledge");
    expect(screen.getByRole("link", { name: /查看失败记录/ })).toHaveAttribute("href", "/runs?status=failed");
    expect(screen.getByText(/有 1 项工作等待员工确认/)).toBeInTheDocument();
    expect(screen.getByText(/有 1 项工作等待外部消息或员工补充/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /等待外部消息或员工补充/ })).toHaveAttribute("href", "/runs?status=waiting_event");
    expect(screen.getByRole("link", { name: /客服助手/ })).toHaveAttribute("href", "/runs/00000000-0000-4000-8000-000000000001");
    expect(screen.getByRole("link", { name: /订单核对助手.*2 个已保存版本/ })).toHaveAttribute("href", "/agents/00000000-0000-4000-8000-000000000003");
    expect(screen.getByText("核对异常订单并说明差异")).toBeInTheDocument();
  });

  it("没有待确认事项时不显示提醒", () => {
    render(<DashboardOverview summary={{
      activeAgents: 0, publishedAgents: 0, indexedSources: 0, activeRuns: 0,
      pendingApprovals: 0, pendingEvents: 0, runsLast24h: 0, failuresLast24h: 0,
    }} recentRuns={[]} recentAgents={[]} />);
    expect(screen.queryByText(/等待员工确认/)).not.toBeInTheDocument();
    expect(screen.queryByText(/等待外部消息或员工补充/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /创建助手/ })).toHaveAttribute("href", "/agents/new");
    expect(screen.getByText(/还没有运行记录/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "创建第一位助手" })).toHaveAttribute("href", "/agents/new");
  });

  it("没有待处理事项时引导查看最近运行", () => {
    render(<DashboardOverview summary={{
      activeAgents: 2, publishedAgents: 2, indexedSources: 3, activeRuns: 0,
      pendingApprovals: 0, pendingEvents: 0, runsLast24h: 4, failuresLast24h: 0,
    }} recentRuns={[]} recentAgents={[]} />);
    expect(screen.getByText("AI 工作团队运行稳定")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /查看最近运行/ })).toHaveAttribute("href", "/runs");
  });
});
