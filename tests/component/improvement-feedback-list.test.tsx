import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImprovementFeedbackList } from "@/features/memory/ImprovementFeedbackList";

const mocks = vi.hoisted(() => ({ createRegression: vi.fn(), refresh: vi.fn() }));
vi.mock("@/server/actions/run-feedback", () => ({
  createRegressionCaseFromRunFeedbackAction: mocks.createRegression,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

const feedback = {
  id: "00000000-0000-4000-8000-000000000001",
  runId: "00000000-0000-4000-8000-000000000002",
  agentId: "00000000-0000-4000-8000-000000000003",
  agentName: "合同助手",
  note: "结果缺少条款依据",
  evaluationCaseId: null,
  updatedAt: "2026-09-26T00:00:00.000Z",
};

describe("待改进运行反馈列表", () => {
  beforeEach(() => vi.clearAllMocks());

  it("展示来源并可直接加入验收样例", async () => {
    mocks.createRegression.mockResolvedValue({
      ok: true, created: true, evaluationCaseId: "00000000-0000-4000-8000-000000000004",
    });
    const user = userEvent.setup();
    render(<ImprovementFeedbackList feedback={[feedback]} />);

    expect(screen.getByText("结果缺少条款依据")).toBeVisible();
    expect(screen.getByRole("link", { name: "查看来源运行" })).toHaveAttribute("href", `/runs/${feedback.runId}`);
    await user.click(screen.getByRole("button", { name: "加入验收样例" }));

    await waitFor(() => expect(mocks.createRegression).toHaveBeenCalledWith(feedback.runId));
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("已加入验收时链接到助手页继续编辑", () => {
    render(<ImprovementFeedbackList feedback={[{
      ...feedback,
      evaluationCaseId: "00000000-0000-4000-8000-000000000004",
    }]} />);

    expect(screen.getByRole("link", { name: "已加入验收" })).toHaveAttribute("href", `/agents/${feedback.agentId}`);
    expect(screen.queryByRole("button", { name: "加入验收样例" })).not.toBeInTheDocument();
  });
});
