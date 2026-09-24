import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RetryRunButton } from "@/features/runs/RetryRunButton";

const { actionMock, pushMock } = vi.hoisted(() => ({ actionMock: vi.fn(), pushMock: vi.fn() }));
vi.mock("@/server/actions/retry-run", () => ({ retryRunAction: actionMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

const RUN_ID = "00000000-0000-4000-8000-000000000061";
const NEW_RUN_ID = "00000000-0000-4000-8000-000000000062";

describe("再次运行", () => {
  afterEach(() => {
    actionMock.mockReset();
    pushMock.mockReset();
  });

  it("成功后打开新运行记录", async () => {
    actionMock.mockResolvedValue({ ok: true, runId: NEW_RUN_ID });
    await userEvent.click(render(<RetryRunButton runId={RUN_ID} />).getByRole("button"));
    await waitFor(() => expect(actionMock).toHaveBeenCalledWith(RUN_ID));
    expect(pushMock).toHaveBeenCalledWith(`/runs/${NEW_RUN_ID}`);
  });

  it("失败时保留当前页面并显示原因", async () => {
    actionMock.mockResolvedValue({ ok: false, error: "原版本已不可用" });
    await userEvent.click(render(<RetryRunButton runId={RUN_ID} />).getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveTextContent("原版本已不可用");
    expect(pushMock).not.toHaveBeenCalled();
  });
});
