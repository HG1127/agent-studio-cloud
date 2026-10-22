import { render, screen, waitFor, within } from "@testing-library/react";
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
  agentArchived: false,
  note: "结果缺少条款依据",
  evaluationCaseId: null,
  updatedAt: "2026-09-26T00:00:00.000Z",
};

describe("待改进运行反馈列表", () => {
  beforeEach(() => vi.resetAllMocks());

  it("先确认复制业务输入，再加入验收并引导补充结果检查", async () => {
    mocks.createRegression.mockResolvedValue({
      ok: true, created: true, evaluationCaseId: "00000000-0000-4000-8000-000000000004",
    });
    const user = userEvent.setup();
    render(<ImprovementFeedbackList feedback={[feedback]} />);

    expect(screen.getByText("结果缺少条款依据")).toBeVisible();
    expect(screen.getByRole("link", { name: "查看来源运行" })).toHaveAttribute("href", `/runs/${feedback.runId}`);
    await user.click(screen.getByRole("button", { name: "加入验收样例" }));
    const dialog = screen.getByRole("dialog", { name: "把这次改进意见加入验收？" });
    expect(dialog).toHaveTextContent("还需到助手页补充期望结果和检查条件");
    expect(mocks.createRegression).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "返回" }));
    expect(mocks.createRegression).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "加入验收样例" }));
    await user.click(within(screen.getByRole("dialog", { name: "把这次改进意见加入验收？" })).getByRole("button", { name: "确认加入" }));

    await waitFor(() => expect(mocks.createRegression).toHaveBeenCalledWith(feedback.runId));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("已加入验收样例");
    expect(screen.getByRole("link", { name: "已加入验收，补充结果检查" })).toHaveAttribute("href", `/agents/${feedback.agentId}#evaluation`);
    expect(screen.queryByRole("button", { name: "加入验收样例" })).not.toBeInTheDocument();
  });

  it("已加入验收时链接到助手页继续编辑", () => {
    render(<ImprovementFeedbackList feedback={[{
      ...feedback,
      evaluationCaseId: "00000000-0000-4000-8000-000000000004",
    }]} />);

    expect(screen.getByRole("link", { name: "已加入验收，补充结果检查" })).toHaveAttribute("href", `/agents/${feedback.agentId}#evaluation`);
    expect(screen.queryByRole("button", { name: "加入验收样例" })).not.toBeInTheDocument();
  });

  it("助手停用后保留改进记录但不显示失效入口", () => {
    render(<ImprovementFeedbackList feedback={[{
      ...feedback,
      agentArchived: true,
      evaluationCaseId: "00000000-0000-4000-8000-000000000004",
    }]} />);

    expect(screen.getByText("助手已停用")).toBeVisible();
    expect(screen.queryByRole("link", { name: "已加入验收，补充结果检查" })).not.toBeInTheDocument();
  });

  it("服务端明确拒绝时只在对应反馈上显示原因", async () => {
    mocks.createRegression.mockResolvedValue({ ok: false, error: "自动验收运行期间不能新增回归样例" });
    const user = userEvent.setup();
    render(<ImprovementFeedbackList feedback={[feedback, { ...feedback, id: "00000000-0000-4000-8000-000000000011", runId: "00000000-0000-4000-8000-000000000012" }]} />);
    await user.click(screen.getAllByRole("button", { name: "加入验收样例" })[0]);
    await user.click(within(screen.getByRole("dialog", { name: "把这次改进意见加入验收？" })).getByRole("button", { name: "确认加入" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("自动验收运行期间不能新增回归样例");
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: "加入验收样例" })).toHaveLength(2);
  });

  it("提交期间锁定确认弹窗和其他改进结果，避免重复创建", async () => {
    let finish: (result: { ok: false; error: string }) => void = () => {};
    mocks.createRegression.mockImplementation(() => new Promise<{ ok: false; error: string }>((resolve) => { finish = resolve; }));
    const user = userEvent.setup();
    render(<ImprovementFeedbackList feedback={[feedback, { ...feedback, id: "00000000-0000-4000-8000-000000000011", runId: "00000000-0000-4000-8000-000000000012" }]} />);
    await user.click(screen.getAllByRole("button", { name: "加入验收样例" })[0]);
    const dialog = screen.getByRole("dialog", { name: "把这次改进意见加入验收？" });
    await user.click(within(dialog).getByRole("button", { name: "确认加入" }));
    expect(within(dialog).getByRole("button", { name: "正在处理…" })).toBeDisabled();
    expect(screen.getByText("正在加入…").closest("button")).toBeDisabled();
    expect(screen.getByText("加入验收样例").closest("button")).toBeDisabled();
    expect(mocks.createRegression).toHaveBeenCalledOnce();
    finish({ ok: false, error: "暂时不能创建" });
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时不能创建");
  });

  it("响应中断时不误称失败，允许重新读取核对", async () => {
    mocks.createRegression.mockRejectedValue(new Error("network interrupted"));
    const user = userEvent.setup();
    const view = render(<ImprovementFeedbackList feedback={[feedback]} />);
    await user.click(screen.getByRole("button", { name: "加入验收样例" }));
    await user.click(within(screen.getByRole("dialog", { name: "把这次改进意见加入验收？" })).getByRole("button", { name: "确认加入" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法确认是否已加入验收样例");
    expect(mocks.refresh).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "重新读取状态" }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    view.rerender(<ImprovementFeedbackList feedback={[{ ...feedback, evaluationCaseId: "00000000-0000-4000-8000-000000000004" }]} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "已加入验收，补充结果检查" })).toBeVisible();
  });
});
