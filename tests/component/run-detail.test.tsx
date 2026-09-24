import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunView } from "@/contracts/run";

const mocks = vi.hoisted(() => ({ steps: vi.fn() }));
vi.mock("@/server/queries/runs", () => ({
  getRunView: async () => RunView.parse({
    id: "00000000-0000-4000-8000-000000000001",
    agentId: "00000000-0000-4000-8000-000000000002",
    agentName: "业务助手", status: "completed", input: {}, result: { ok: true },
    error: null, startedAt: null, finishedAt: null,
  }),
  listRunSteps: mocks.steps,
  listApprovals: async () => [],
  getRunContext: async () => ({ outputs: { analyze: { output: "分析完成" } } }),
}));
vi.mock("@/server/queries/trace", () => ({ listTrace: async () => [] }));
vi.mock("@/features/runs/TraceTimeline", () => ({ TraceTimeline: () => null }));
vi.mock("@/features/runs/ApprovalPanel", () => ({ ApprovalPanel: () => null }));
vi.mock("@/features/runs/CancelRunButton", () => ({ CancelRunButton: () => null }));
vi.mock("@/features/runs/RetryRunButton", () => ({ RetryRunButton: () => null }));

import { RunDetail } from "@/features/runs/RunDetail";

afterEach(() => vi.clearAllMocks());

describe("运行详情步骤数据", () => {
  it("提供完整运行报告下载入口", async () => {
    mocks.steps.mockResolvedValue([]);
    render(await RunDetail({ runId: "00000000-0000-4000-8000-000000000001" }));
    expect(screen.getByRole("link", { name: "下载运行报告" })).toHaveAttribute(
      "href",
      "/api/runs/00000000-0000-4000-8000-000000000001/export",
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
    expect(screen.getAllByText("分析客户反馈")).toHaveLength(2);
  });

  it("没有步骤输出时不显示数据入口，也不虚构用量", async () => {
    mocks.steps.mockResolvedValue([{
      id: "step-id", nodeId: "analyze", nodeTitle: "分析客户反馈", status: "running", output: null,
    }]);
    render(await RunDetail({ runId: "00000000-0000-4000-8000-000000000001" }));
    expect(screen.queryByText("查看步骤数据（开发者数据）")).not.toBeInTheDocument();
    expect(screen.queryByText(/inputTokens/)).not.toBeInTheDocument();
  });
});
