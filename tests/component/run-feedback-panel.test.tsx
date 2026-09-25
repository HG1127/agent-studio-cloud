import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RunFeedbackPanel } from "@/features/runs/RunFeedbackPanel";

const mocks = vi.hoisted(() => ({ save: vi.fn(), createRegression: vi.fn() }));
vi.mock("@/server/actions/run-feedback", () => ({
  saveRunFeedbackAction: mocks.save,
  createRegressionCaseFromRunFeedbackAction: mocks.createRegression,
}));

const RUN_ID = "00000000-0000-4000-8000-000000000001";
const AGENT_ID = "00000000-0000-4000-8000-000000000002";
const FEEDBACK_ID = "00000000-0000-4000-8000-000000000003";
const CASE_ID = "00000000-0000-4000-8000-000000000004";

describe("运行结果反馈", () => {
  beforeEach(() => vi.clearAllMocks());

  it("需要改进时要求填写说明并保存反馈", async () => {
    mocks.save.mockResolvedValue({
      ok: true,
      feedback: {
        id: FEEDBACK_ID, runId: RUN_ID, rating: "needs_improvement", note: "缺少合同依据",
        evaluationCaseId: null, updatedAt: "2026-09-26T00:00:00.000Z",
      },
    });
    const user = userEvent.setup();
    render(<RunFeedbackPanel runId={RUN_ID} agentId={AGENT_ID} initialFeedback={null} />);

    await user.click(screen.getByRole("button", { name: "需要改进" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请说明这次结果需要改进的地方");
    expect(mocks.save).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("结果反馈说明"), "缺少合同依据");
    await user.click(screen.getByRole("button", { name: "需要改进" }));

    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({
      runId: RUN_ID, rating: "needs_improvement", note: "缺少合同依据",
    }));
    expect(screen.getByRole("status")).toHaveTextContent("已记录改进意见");
    expect(screen.getByRole("button", { name: "加入验收样例" })).toBeVisible();
  });

  it("差评可以复制真实输入为验收样例且不会重复创建", async () => {
    mocks.createRegression.mockResolvedValue({ ok: true, evaluationCaseId: CASE_ID, created: true });
    const user = userEvent.setup();
    render(<RunFeedbackPanel runId={RUN_ID} agentId={AGENT_ID} initialFeedback={{
      id: FEEDBACK_ID, runId: RUN_ID, rating: "needs_improvement", note: "缺少依据",
      evaluationCaseId: null, updatedAt: "2026-09-26T00:00:00.000Z",
    }} />);

    await user.click(screen.getByRole("button", { name: "加入验收样例" }));

    await waitFor(() => expect(mocks.createRegression).toHaveBeenCalledWith(RUN_ID));
    expect(screen.getByRole("status")).toHaveTextContent("已加入验收样例");
    expect(screen.getByRole("link", { name: "前往补充结果检查" })).toHaveAttribute("href", `/agents/${AGENT_ID}`);
    expect(screen.queryByRole("button", { name: "加入验收样例" })).not.toBeInTheDocument();
  });
});
