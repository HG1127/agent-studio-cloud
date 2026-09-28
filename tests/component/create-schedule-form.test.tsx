import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateScheduleForm } from "@/features/schedules/CreateScheduleForm";

const mocks = vi.hoisted(() => ({ create: vi.fn(), refresh: vi.fn() }));
vi.mock("@/server/actions/create-schedule", () => ({ createScheduleAction: mocks.create }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

const AGENT_ID = "00000000-0000-4000-8000-0000000000a1";
const REQUEST_ID = "00000000-0000-4000-8000-0000000000a2";

beforeEach(() => {
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(REQUEST_ID);
  mocks.create.mockReset();
  mocks.refresh.mockReset();
});

afterEach(() => vi.restoreAllMocks());

describe("定时任务创建请求恢复", () => {
  it("网络异常后可再次提交且沿用原请求标识", async () => {
    mocks.create.mockRejectedValueOnce(new Error("模拟回执丢失")).mockResolvedValueOnce({ ok: true });
    const user = userEvent.setup();
    render(<CreateScheduleForm agents={[{ id: AGENT_ID, name: "测试助手" }]} />);

    await user.click(screen.getByRole("button", { name: "创建定时任务" }));
    expect(await screen.findByText("创建状态待确认，请检查网络后用同一设置重试")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "创建定时任务" }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create.mock.calls[0][0].requestId).toBe(REQUEST_ID);
    expect(mocks.create.mock.calls[1][0].requestId).toBe(REQUEST_ID);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("状态待确认时保留请求标识，输入变更后开启新请求", async () => {
    const nextId = "00000000-0000-4000-8000-0000000000a3";
    vi.mocked(globalThis.crypto.randomUUID).mockReturnValueOnce(REQUEST_ID).mockReturnValueOnce(nextId);
    mocks.create.mockResolvedValueOnce({ ok: false, error: "状态待确认", retryable: true }).mockResolvedValueOnce({ ok: true });
    const user = userEvent.setup();
    render(<CreateScheduleForm agents={[{ id: AGENT_ID, name: "测试助手" }]} />);

    await user.click(screen.getByRole("button", { name: "创建定时任务" }));
    expect(await screen.findByText("状态待确认")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("运行输入（JSON）"), { target: { value: '{"task":"新内容"}' } });
    await user.click(screen.getByRole("button", { name: "创建定时任务" }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create.mock.calls[0][0].requestId).toBe(REQUEST_ID);
    expect(mocks.create.mock.calls[1][0].requestId).toBe(nextId);
  });

  it("成功后刷新完成前重复点击相同设置仍沿用请求标识", async () => {
    mocks.create.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<CreateScheduleForm agents={[{ id: AGENT_ID, name: "测试助手" }]} />);

    await user.click(screen.getByRole("button", { name: "创建定时任务" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    await user.click(screen.getByRole("button", { name: "创建定时任务" }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create.mock.calls[0][0].requestId).toBe(REQUEST_ID);
    expect(mocks.create.mock.calls[1][0].requestId).toBe(REQUEST_ID);
  });
});
