import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateScheduleForm } from "@/features/schedules/CreateScheduleForm";
import { SCHEDULE_CREATE_PENDING_KEY, serializeScheduleCreatePending } from "@/features/schedules/schedule-create-pending";

const mocks = vi.hoisted(() => ({ create: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/server/actions/create-schedule", () => ({ createScheduleAction: mocks.create }));

const agents = [{
  id: "00000000-0000-4000-8000-0000000000e9",
  name: "合同审核助手",
  version: 3,
  inputContract: { fields: [{ name: "document", label: "合同内容", type: "string" as const, required: true }] },
}];

afterEach(() => {
  mocks.create.mockReset();
  mocks.refresh.mockReset();
  window.sessionStorage.clear();
});

describe("创建定时任务", () => {
  it("展示正式版本、契约字段和运行预览", () => {
    render(<CreateScheduleForm agents={agents} />);
    fireEvent.click(screen.getByRole("button", { name: "新建定时任务" }));
    expect(screen.getByRole("dialog", { name: "新建定时任务" })).toBeInTheDocument();
    expect(screen.getByText("当前显示：正式版本 V3")).toBeInTheDocument();
    expect(screen.getByLabelText(/合同内容/)).toBeInTheDocument();
    expect(screen.getByText(/合同审核助手 · 每天 09:00/)).toBeInTheDocument();
    expect(screen.getByText(/自动运行使用执行时的正式版本/)).toBeInTheDocument();
    expect(screen.queryByText(/固定使用正式版本/)).not.toBeInTheDocument();
  });

  it("校验必填输入并通过真实动作创建", async () => {
    mocks.create.mockResolvedValueOnce({ ok: true });
    render(<CreateScheduleForm agents={agents} />);
    fireEvent.click(screen.getByRole("button", { name: "新建定时任务" }));
    fireEvent.click(screen.getByRole("button", { name: "创建并启用" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请填写合同内容");
    fireEvent.change(screen.getByLabelText(/合同内容/), { target: { value: "合同正文" } });
    fireEvent.click(screen.getByRole("button", { name: "创建并启用" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      agentId: agents[0].id,
      spec: { kind: "daily", times: ["09:00"] },
      input: { document: "合同正文" },
    })));
    expect(await screen.findByRole("status")).toHaveTextContent("定时任务已创建");
    expect(mocks.refresh).toHaveBeenCalled();
    expect(window.sessionStorage.getItem(SCHEDULE_CREATE_PENDING_KEY)).toBeNull();
  });

  it("一次性任务按北京时间提交确定的执行时刻", async () => {
    mocks.create.mockResolvedValueOnce({ ok: true });
    render(<CreateScheduleForm agents={agents} />);
    fireEvent.click(screen.getByRole("button", { name: "新建定时任务" }));
    fireEvent.click(screen.getByRole("button", { name: /执行一次/ }));
    fireEvent.change(screen.getByLabelText("执行时间"), { target: { value: "2099-05-03T09:30" } });
    fireEvent.change(screen.getByLabelText(/合同内容/), { target: { value: "合同正文" } });
    fireEvent.click(screen.getByRole("button", { name: "创建并启用" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      spec: { kind: "once", at: "2099-05-03T01:30:00.000Z" },
    })));
  });

  it("网络中断时提示先核对列表，避免重复创建", async () => {
    mocks.create.mockRejectedValueOnce(new Error("connection lost"));
    render(<CreateScheduleForm agents={agents} />);
    fireEvent.click(screen.getByRole("button", { name: "新建定时任务" }));
    fireEvent.change(screen.getByLabelText(/合同内容/), { target: { value: "合同正文" } });
    fireEvent.click(screen.getByRole("button", { name: "创建并启用" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("先关闭面板核对任务列表");
    expect(mocks.refresh).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "创建并启用" })).toBeDisabled();
    expect(screen.getByRole("region", { name: "上次创建结果待核对" })).toBeVisible();
    expect(window.sessionStorage.getItem(SCHEDULE_CREATE_PENDING_KEY)).not.toContain("合同正文");
    fireEvent.click(screen.getByRole("button", { name: "已核对，准备新建另一条" }));
    expect(screen.getByRole("group", { name: "确认重新创建" })).toHaveTextContent("可能产生另一条相同计划");
    fireEvent.click(screen.getByRole("button", { name: "继续核对" }));
    expect(screen.getByRole("button", { name: "创建并启用" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "已核对，准备新建另一条" }));
    fireEvent.click(screen.getByRole("button", { name: "确认风险，允许重新创建" }));
    expect(screen.getByRole("button", { name: "创建并启用" })).toBeEnabled();
    expect(window.sessionStorage.getItem(SCHEDULE_CREATE_PENDING_KEY)).toBeNull();
  });

  it("刷新后恢复不确定结果，核对前不能再次创建", async () => {
    window.sessionStorage.setItem(SCHEDULE_CREATE_PENDING_KEY, serializeScheduleCreatePending({
      agentName: "合同审核助手", summary: "每天 09:00", submittedAt: "2026-09-28T00:00:00.000Z",
    }));
    render(<CreateScheduleForm agents={agents} />);
    fireEvent.click(screen.getByRole("button", { name: "新建定时任务" }));
    expect(await screen.findByRole("region", { name: "上次创建结果待核对" })).toHaveTextContent("合同审核助手 · 每天 09:00");
    expect(screen.getByRole("button", { name: "创建并启用" })).toBeDisabled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
