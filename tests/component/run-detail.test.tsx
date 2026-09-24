import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RunView } from "@/contracts/run";

const mocks = vi.hoisted(() => ({ steps: vi.fn(), childRuns: vi.fn() }));
vi.mock("@/server/queries/runs", () => ({
  getRunView: async () => RunView.parse({
    id: "00000000-0000-4000-8000-000000000001",
    agentId: "00000000-0000-4000-8000-000000000002",
    agentName: "业务助手", status: "completed", sourceType: "agent_call",
    parentRunId: "00000000-0000-4000-8000-000000000003", input: {}, result: { ok: true },
    error: null, startedAt: null, finishedAt: null,
  }),
  listRunSteps: mocks.steps,
  listApprovals: async () => [],
  listChildRuns: mocks.childRuns,
  getRunContext: async () => ({ outputs: { analyze: { output: "分析完成" } } }),
  getPendingWait: async () => null,
}));
vi.mock("@/server/queries/trace", () => ({ listTrace: async () => [] }));
vi.mock("@/features/runs/TraceTimeline", () => ({ TraceTimeline: () => null }));
vi.mock("@/features/runs/ApprovalPanel", () => ({ ApprovalPanel: () => null }));
vi.mock("@/features/runs/CancelRunButton", () => ({ CancelRunButton: () => null }));
vi.mock("@/features/runs/RetryRunButton", () => ({ RetryRunButton: () => null }));
vi.mock("@/features/runs/WaitEventPanel", () => ({ WaitEventPanel: () => null }));

import { RunDetail } from "@/features/runs/RunDetail";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.childRuns.mockResolvedValue([]);
});

describe("运行详情步骤数据", () => {
  it("提供完整运行报告下载入口", async () => {
    mocks.steps.mockResolvedValue([]);
    render(await RunDetail({ runId: "00000000-0000-4000-8000-000000000001" }));
    expect(screen.getByRole("link", { name: "下载运行报告" })).toHaveAttribute(
      "href",
      "/api/runs/00000000-0000-4000-8000-000000000001/export",
    );
    expect(screen.getByRole("link", { name: "查看上级运行" })).toHaveAttribute(
      "href",
      "/runs/00000000-0000-4000-8000-000000000003",
    );
  });

  it("可展开步骤的持久化输出和模型用量，不依赖最终结果包含用量", async () => {
    mocks.steps.mockResolvedValue([{
      id: "step-id", nodeId: "analyze", nodeTitle: "分析客户反馈", status: "succeeded",
      output: { output: "分析完成", usage: { inputTokens: 12, outputTokens: 6 } },
    }]);
    render(await RunDetail({ runId: "00000000-0000-4000-8000-000000000001" }));
    const user = userEvent.setup();
    await user.click(screen.getByText("查看步骤数据（开发者数据）"));
    expect(screen.getByText(/"inputTokens": 12/)).toBeVisible();
    expect(screen.getByText(/"outputTokens": 6/)).toBeVisible();
    expect(screen.getAllByText("分析客户反馈")).toHaveLength(1);
    expect(screen.queryByText("分析完成")).not.toBeInTheDocument();
  });

  it("没有步骤输出时不显示数据入口，也不虚构用量", async () => {
    mocks.steps.mockResolvedValue([{
      id: "step-id", nodeId: "analyze", nodeTitle: "分析客户反馈", status: "running", output: null,
    }]);
    render(await RunDetail({ runId: "00000000-0000-4000-8000-000000000001" }));
    expect(screen.queryByText("查看步骤数据（开发者数据）")).not.toBeInTheDocument();
    expect(screen.queryByText(/inputTokens/)).not.toBeInTheDocument();
  });

  it("父运行展示可进入的协作与交接子任务", async () => {
    mocks.steps.mockResolvedValue([]);
    mocks.childRuns.mockResolvedValue([
      {
        id: "00000000-0000-4000-8000-000000000011",
        agentId: "00000000-0000-4000-8000-000000000012",
        agentName: "资料研究助手",
        status: "running",
        sourceType: "agent_call",
        agentArchived: false,
        startedAt: null,
        finishedAt: null,
      },
      {
        id: "00000000-0000-4000-8000-000000000013",
        agentId: "00000000-0000-4000-8000-000000000014",
        agentName: "交付助手",
        status: "completed",
        sourceType: "handoff",
        agentArchived: false,
        startedAt: null,
        finishedAt: null,
      },
    ]);

    render(await RunDetail({ runId: "00000000-0000-4000-8000-000000000001" }));

    expect(screen.getByRole("heading", { name: "协作子任务" })).toBeVisible();
    expect(screen.getByRole("link", { name: "资料研究助手" })).toHaveAttribute("href", "/runs/00000000-0000-4000-8000-000000000011");
    expect(screen.getByText("助手协作")).toBeVisible();
    expect(screen.getByText("助手交接")).toBeVisible();
  });
});
