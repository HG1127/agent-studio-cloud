import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApprovalPanel } from "@/features/runs/ApprovalPanel";
import type { ApprovalView } from "@/contracts/run";

const { actionMock, refreshMock } = vi.hoisted(() => ({
  actionMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("@/server/actions/decide-approval", () => ({ decideApprovalAction: actionMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const RUN_ID = "3f0d2c9e-8a7b-4c1d-9e2f-1a2b3c4d5e6f";

const PENDING: ApprovalView = {
  id: "a1b2c3d4-0000-4000-8000-0000000000a1",
  runId: RUN_ID,
  nodeId: "confirm",
  nodeTitle: "负责人确认处理方案",
  status: "pending",
  role: "业务负责人",
  reason: "确认“负责人确认处理方案”后流程才会继续",
  review: null,
  note: null,
  decidedAt: null,
};

const DECIDED: ApprovalView = {
  ...PENDING,
  status: "approved",
  note: "同意执行",
  decidedAt: "2026-09-21T10:00:00.000Z",
};

describe("ApprovalPanel", () => {
  afterEach(() => {
    actionMock.mockReset();
    refreshMock.mockReset();
  });

  it("等待确认时显示等待提示、负责人、确认事项与批准/拒绝按钮", () => {
    render(<ApprovalPanel runId={RUN_ID} approval={PENDING} />);
    expect(screen.getByText("该步骤正在等待确认")).toBeInTheDocument();
    expect(screen.getByText("业务负责人")).toBeInTheDocument();
    expect(screen.getByText("确认“负责人确认处理方案”后流程才会继续")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "批准" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "拒绝" })).toBeInTheDocument();
  });

  it("待确认和已确认时都展示同一份回复草稿", () => {
    const review = { sourceNodeId: "draft", sourceTitle: "生成回复草稿", content: "您好，签收后七天内可申请退货。" };
    const { rerender } = render(<ApprovalPanel runId={RUN_ID} approval={{ ...PENDING, review }} />);
    expect(screen.getByText("待确认草稿")).toBeInTheDocument();
    expect(screen.getByText(review.content)).toBeInTheDocument();
    rerender(<ApprovalPanel runId={RUN_ID} approval={{ ...DECIDED, review }} />);
    expect(screen.getByText("本次确认的草稿")).toBeInTheDocument();
    expect(screen.getByText(review.content)).toBeInTheDocument();
  });

  it("点批准调用审批动作并携带备注，成功后刷新页面", async () => {
    actionMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<ApprovalPanel runId={RUN_ID} approval={PENDING} />);
    await user.type(screen.getByLabelText("备注"), "同意执行");
    await user.click(screen.getByRole("button", { name: "批准" }));
    await waitFor(() => {
      expect(actionMock).toHaveBeenCalledWith(RUN_ID, PENDING.id, { decision: "approved", note: "同意执行" });
    });
    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("点拒绝调用审批动作且 decision 为 rejected", async () => {
    actionMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<ApprovalPanel runId={RUN_ID} approval={PENDING} />);
    await user.click(screen.getByRole("button", { name: "拒绝" }));
    await waitFor(() => {
      expect(actionMock).toHaveBeenCalledWith(RUN_ID, PENDING.id, { decision: "rejected", note: "" });
    });
  });

  it("提交中按钮不可重复点击", async () => {
    let resolveAction: (value: { ok: boolean }) => void = () => {};
    actionMock.mockReturnValue(
      new Promise((resolve) => {
        resolveAction = resolve;
      }),
    );
    const user = userEvent.setup();
    render(<ApprovalPanel runId={RUN_ID} approval={PENDING} />);
    await user.click(screen.getByRole("button", { name: "批准" }));
    expect(screen.getByRole("button", { name: "正在提交…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "拒绝" })).toBeDisabled();
    resolveAction({ ok: true });
    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalledTimes(1);
    });
  });

  it("动作失败时展示中文错误且不刷新", async () => {
    actionMock.mockResolvedValue({ ok: false, error: "这条确认已经处理过，请勿重复提交" });
    const user = userEvent.setup();
    render(<ApprovalPanel runId={RUN_ID} approval={PENDING} />);
    await user.click(screen.getByRole("button", { name: "批准" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("这条确认已经处理过，请勿重复提交");
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("审批请求中断时显示网络错误并允许重试", async () => {
    actionMock.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    render(<ApprovalPanel runId={RUN_ID} approval={PENDING} />);
    await user.click(screen.getByRole("button", { name: "批准" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("提交失败，请检查网络后重试");
    expect(screen.getByRole("button", { name: "批准" })).toBeEnabled();
  });

  it("已决定时显示结果与备注，不再显示操作按钮", () => {
    render(<ApprovalPanel runId={RUN_ID} approval={DECIDED} />);
    expect(screen.getByText("已确认")).toBeInTheDocument();
    expect(screen.getByText("同意执行")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "批准" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "拒绝" })).not.toBeInTheDocument();
  });

  it("已拒绝时显示未获确认结果", () => {
    render(<ApprovalPanel runId={RUN_ID} approval={{ ...DECIDED, status: "rejected" }} />);
    expect(screen.getByText("未获确认")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "批准" })).not.toBeInTheDocument();
  });
});
