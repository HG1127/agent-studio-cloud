import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CancelRunButton } from "@/features/runs/CancelRunButton";

const { cancelMock, refreshMock } = vi.hoisted(() => ({ cancelMock: vi.fn(), refreshMock: vi.fn() }));
vi.mock("@/server/actions/cancel-run", () => ({ cancelRunAction: cancelMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

describe("CancelRunButton", () => {
  afterEach(() => {
    cancelMock.mockReset();
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  it("确认后取消工作流并刷新状态", async () => {
    cancelMock.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<CancelRunButton runId="00000000-0000-4000-8000-000000000051" />);
    await user.click(screen.getByRole("button", { name: "取消运行" }));
    await user.click(screen.getByRole("button", { name: "确认取消" }));
    await waitFor(() => expect(cancelMock).toHaveBeenCalled());
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("取消失败时展示错误", async () => {
    cancelMock.mockResolvedValue({ ok: false, error: "运行已经结束" });
    const user = userEvent.setup();
    render(<CancelRunButton runId="00000000-0000-4000-8000-000000000051" />);
    await user.click(screen.getByRole("button", { name: "取消运行" }));
    await user.click(screen.getByRole("button", { name: "确认取消" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("运行已经结束");
  });

  it("从协作子任务取消时明确提示会停止整条执行链", async () => {
    const user = userEvent.setup();
    render(<CancelRunButton runId="00000000-0000-4000-8000-000000000051" cancelsChain />);

    await user.click(screen.getByRole("button", { name: "取消运行" }));

    expect(screen.getByText(/同时停止上级任务和同一执行链中的其他子任务/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认停止整条任务" })).toBeInTheDocument();
    expect(cancelMock).not.toHaveBeenCalled();
  });
});
