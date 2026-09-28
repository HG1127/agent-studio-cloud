import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RunFeedbackPanel } from "@/features/runs/RunFeedbackPanel";

const mocks = vi.hoisted(() => ({ save: vi.fn(), createRegression: vi.fn(), refresh: vi.fn() }));
vi.mock("@/server/actions/run-feedback", () => ({
  saveRunFeedbackAction: mocks.save,
  createRegressionCaseFromRunFeedbackAction: mocks.createRegression,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

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
    render(<RunFeedbackPanel runId={RUN_ID} agentId={AGENT_ID} agentArchived={false} initialFeedback={null} />);

    await user.click(screen.getByRole("button", { name: /需要改进/ }));
    expect(screen.getByLabelText("结果反馈说明")).toBeVisible();
    expect(mocks.save).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "保存改进意见" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请说明这次结果需要改进的地方");
    expect(mocks.save).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("结果反馈说明"), "缺少合同依据");
    await user.click(screen.getByRole("button", { name: "保存改进意见" }));

    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({
      runId: RUN_ID, rating: "needs_improvement", note: "缺少合同依据",
    }));
    expect(screen.getByRole("status")).toHaveTextContent("已记录改进意见");
    expect(screen.getByRole("button", { name: "加入验收样例" })).toBeVisible();
  });

  it("差评可以复制真实输入为验收样例且不会重复创建", async () => {
    mocks.createRegression.mockResolvedValue({ ok: true, evaluationCaseId: CASE_ID, created: true });
    const user = userEvent.setup();
    render(<RunFeedbackPanel runId={RUN_ID} agentId={AGENT_ID} agentArchived={false} initialFeedback={{
      id: FEEDBACK_ID, runId: RUN_ID, rating: "needs_improvement", note: "缺少依据",
      evaluationCaseId: null, updatedAt: "2026-09-26T00:00:00.000Z",
    }} />);

    expect(screen.getByRole("button", { name: "意见已保存" })).toBeDisabled();
    await user.type(screen.getByLabelText("结果反馈说明"), "，缺少附件");
    expect(screen.getByRole("button", { name: "保存改进意见" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "加入验收样例" }));

    await waitFor(() => expect(mocks.createRegression).toHaveBeenCalledWith(RUN_ID));
    expect(screen.getByRole("status")).toHaveTextContent("已加入验收样例");
    expect(screen.getByRole("link", { name: "前往补充结果检查" })).toHaveAttribute("href", `/agents/${AGENT_ID}#evaluation`);
    expect(screen.queryByRole("button", { name: "加入验收样例" })).not.toBeInTheDocument();
  });

  it("服务端隐藏误贴的凭据后立即更新输入框", async () => {
    mocks.save.mockResolvedValue({
      ok: true,
      feedback: {
        id: FEEDBACK_ID, runId: RUN_ID, rating: "needs_improvement", note: "请检查 [已隐藏敏感信息]",
        evaluationCaseId: null, updatedAt: "2026-09-26T00:00:00.000Z",
      },
    });
    const user = userEvent.setup();
    render(<RunFeedbackPanel runId={RUN_ID} agentId={AGENT_ID} agentArchived={false} initialFeedback={null} />);

    await user.click(screen.getByRole("button", { name: /需要改进/ }));
    await user.type(screen.getByLabelText("结果反馈说明"), "请检查 authorization: Bearer private-feedback-token");
    await user.click(screen.getByRole("button", { name: "保存改进意见" }));

    await waitFor(() => expect(screen.getByLabelText("结果反馈说明")).toHaveValue("请检查 [已隐藏敏感信息]"));
  });

  it("助手停用后保留反馈但不展示失效的验收入口", () => {
    render(<RunFeedbackPanel runId={RUN_ID} agentId={AGENT_ID} agentArchived initialFeedback={{
      id: FEEDBACK_ID, runId: RUN_ID, rating: "needs_improvement", note: "缺少依据",
      evaluationCaseId: CASE_ID, updatedAt: "2026-09-26T00:00:00.000Z",
    }} />);

    expect(screen.getByText(/助手已停用，样例仍保留/)).toBeVisible();
    expect(screen.queryByRole("link", { name: "前往补充结果检查" })).not.toBeInTheDocument();
  });

  it("改为符合预期时不携带旧差评说明，已有验收样例仍保留", async () => {
    mocks.save.mockResolvedValue({ ok: true, feedback: {
      id: FEEDBACK_ID, runId: RUN_ID, rating: "useful", note: null,
      evaluationCaseId: CASE_ID, updatedAt: "2026-09-26T00:01:00.000Z",
    } });
    const user = userEvent.setup();
    render(<RunFeedbackPanel runId={RUN_ID} agentId={AGENT_ID} agentArchived={false} initialFeedback={{
      id: FEEDBACK_ID, runId: RUN_ID, rating: "needs_improvement", note: "旧的问题说明",
      evaluationCaseId: CASE_ID, updatedAt: "2026-09-26T00:00:00.000Z",
    }} />);

    await user.click(screen.getByRole("button", { name: /符合预期/ }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ runId: RUN_ID, rating: "useful", note: null }));
    expect(screen.queryByLabelText("结果反馈说明")).not.toBeInTheDocument();
    expect(screen.getByText(/此前创建的验收样例仍保留/)).toBeVisible();
  });

  it("反馈和验收请求结果不确定时先提示刷新核对", async () => {
    mocks.save.mockRejectedValueOnce(new Error("offline"));
    mocks.createRegression.mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    const { unmount } = render(<RunFeedbackPanel runId={RUN_ID} agentId={AGENT_ID} agentArchived={false} initialFeedback={null} />);
    await user.click(screen.getByRole("button", { name: /符合预期/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法确认反馈是否保存");
    await user.click(screen.getByRole("button", { name: "刷新并核对反馈" }));
    expect(mocks.refresh).toHaveBeenCalledOnce();

    unmount();
    render(<RunFeedbackPanel runId={RUN_ID} agentId={AGENT_ID} agentArchived={false} initialFeedback={{
      id: FEEDBACK_ID, runId: RUN_ID, rating: "needs_improvement", note: "缺少依据",
      evaluationCaseId: null, updatedAt: "2026-09-26T00:00:00.000Z",
    }} />);
    await user.click(screen.getByRole("button", { name: "加入验收样例" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法确认是否已加入验收样例");
    expect(mocks.createRegression).toHaveBeenCalledOnce();
  });
});
