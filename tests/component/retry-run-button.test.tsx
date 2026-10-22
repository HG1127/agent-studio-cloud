import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RetryRunButton } from "@/features/runs/RetryRunButton";

const { actionMock, pushMock } = vi.hoisted(() => ({ actionMock: vi.fn(), pushMock: vi.fn() }));
vi.mock("@/server/actions/retry-run", () => ({ retryRunAction: actionMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

const RUN_ID = "00000000-0000-4000-8000-000000000061";
const NEW_RUN_ID = "00000000-0000-4000-8000-000000000062";
const REQUEST_ID = "00000000-0000-4000-8000-000000000063";

describe("再次运行", () => {
  beforeEach(() => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(REQUEST_ID);
  });

  afterEach(() => {
    actionMock.mockReset();
    pushMock.mockReset();
    vi.restoreAllMocks();
  });

  it("成功后打开新运行记录", async () => {
    actionMock.mockResolvedValue({ ok: true, runId: NEW_RUN_ID });
    await userEvent.click(render(<RetryRunButton runId={RUN_ID} />).getByRole("button"));
    await waitFor(() => expect(actionMock).toHaveBeenCalledWith(RUN_ID, REQUEST_ID));
    expect(pushMock).toHaveBeenCalledWith(`/runs/${NEW_RUN_ID}`);
  });

  it("失败时保留当前页面并显示原因", async () => {
    actionMock.mockResolvedValue({ ok: false, error: "原版本已不可用" });
    await userEvent.click(render(<RetryRunButton runId={RUN_ID} />).getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveTextContent("原版本已不可用");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("网络中断后复用同一个再次运行请求", async () => {
    actionMock.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({ ok: true, runId: NEW_RUN_ID });
    const user = userEvent.setup();
    render(<RetryRunButton runId={RUN_ID} />);

    await user.click(screen.getByRole("button"));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button"));

    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(2));
    expect(actionMock.mock.calls[0]).toEqual([RUN_ID, REQUEST_ID]);
    expect(actionMock.mock.calls[1]).toEqual([RUN_ID, REQUEST_ID]);
  });

  it("连续点击只发起一次再次运行", async () => {
    actionMock.mockImplementation(() => new Promise(() => undefined));
    render(<RetryRunButton runId={RUN_ID} />);
    const button = screen.getByRole("button");

    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(actionMock).toHaveBeenCalledOnce());
  });
});
