import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateScheduleForm } from "@/features/schedules/CreateScheduleForm";
import { AgentTargetOption } from "@/contracts/agent";
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
const productionVersions = agents.map((agent) => AgentTargetOption.parse({
  agentId: agent.id, agentName: agent.name, versionId: "00000000-0000-4000-8000-0000000000e8",
  version: agent.version, inputContract: agent.inputContract, outputContract: { fields: [] },
}));

afterEach(() => {
  mocks.create.mockReset();
  mocks.refresh.mockReset();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("创建定时任务", () => {
  it("展示正式版本、契约字段和运行预览", () => {
    render(<CreateScheduleForm agents={agents} productionVersions={productionVersions} />);
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
    render(<CreateScheduleForm agents={agents} productionVersions={productionVersions} />);
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
    render(<CreateScheduleForm agents={agents} productionVersions={productionVersions} />);
    fireEvent.click(screen.getByRole("button", { name: "新建定时任务" }));
    fireEvent.click(screen.getByRole("button", { name: /执行一次/ }));
    fireEvent.change(screen.getByLabelText("计划时间"), { target: { value: "2099-05-03T09:30" } });
    fireEvent.change(screen.getByLabelText(/合同内容/), { target: { value: "合同正文" } });
    fireEvent.click(screen.getByRole("button", { name: "创建并启用" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      spec: { kind: "once", at: "2099-05-03T01:30:00.000Z" },
    })));
  });

  it("网络中断时提示先核对列表，避免重复创建", async () => {
    mocks.create.mockRejectedValueOnce(new Error("connection lost"));
    render(<CreateScheduleForm agents={agents} productionVersions={productionVersions} />);
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
    render(<CreateScheduleForm agents={agents} productionVersions={productionVersions} />);
    fireEvent.click(screen.getByRole("button", { name: "新建定时任务" }));
    expect(await screen.findByRole("region", { name: "上次创建结果待核对" })).toHaveTextContent("合同审核助手 · 每天 09:00");
    expect(screen.getByRole("button", { name: "创建并启用" })).toBeDisabled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});

describe("新接口下的原请求防重", () => {
  const requestId = "00000000-0000-4000-8000-0000000000a2";
  function open() {
    render(<CreateScheduleForm agents={[{ id: agents[0].id, name: agents[0].name }]} />);
    fireEvent.click(screen.getByRole("button", { name: "新建定时任务" }));
  }
  it("网络异常后沿用同一请求和原输入核对，而不是新建", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(requestId);
    mocks.create.mockRejectedValueOnce(new Error("回执丢失")).mockResolvedValueOnce({ ok: true });
    open();
    fireEvent.click(screen.getByRole("button", { name: "创建并启用" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("先关闭面板核对任务列表");
    fireEvent.click(screen.getByRole("button", { name: "核对上次创建请求" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create.mock.calls[0][0].requestId).toBe(requestId);
    expect(mocks.create.mock.calls[1][0]).toEqual(mocks.create.mock.calls[0][0]);
    expect(await screen.findByRole("status")).toHaveTextContent("定时任务已创建");
  });
  it("状态待确认保留原请求，明确核对风险并变更输入后才创建新请求", async () => {
    const nextId = "00000000-0000-4000-8000-0000000000a3";
    vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(requestId).mockReturnValueOnce(nextId);
    mocks.create.mockResolvedValueOnce({ ok: false, error: "状态待确认", retryable: true }).mockResolvedValueOnce({ ok: true });
    open();
    fireEvent.click(screen.getByRole("button", { name: "创建并启用" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("状态待确认");
    fireEvent.click(screen.getByRole("button", { name: "已核对，准备新建另一条" }));
    fireEvent.click(screen.getByRole("button", { name: "确认风险，允许重新创建" }));
    fireEvent.change(screen.getByRole("textbox", { name: /运行输入（对象格式）/ }), { target: { value: '{"task":"新内容"}' } });
    fireEvent.click(screen.getByRole("button", { name: "创建并启用" }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create.mock.calls[0][0].requestId).toBe(requestId);
    expect(mocks.create.mock.calls[1][0]).toMatchObject({ requestId: nextId, input: { task: "新内容" } });
  });
  it("成功后页面刷新前重复提交相同设置仍沿用请求标识", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(requestId);
    mocks.create.mockResolvedValue({ ok: true });
    open();
    fireEvent.click(screen.getByRole("button", { name: "创建并启用" }));
    expect(await screen.findByRole("status")).toHaveTextContent("定时任务已创建");
    fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
    await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(2));
    expect(mocks.create.mock.calls[0][0].requestId).toBe(requestId);
    expect(mocks.create.mock.calls[1][0].requestId).toBe(requestId);
  });
  it("没有公开正式版本输入时不展示未核实的版本或虚构字段", () => {
    open();
    expect(screen.getByText("正式版本输入信息暂不可读")).toBeVisible();
    expect(screen.getByRole("textbox", { name: /运行输入（对象格式）/ })).toBeVisible();
    expect(screen.queryByText(/正式版本 V/)).not.toBeInTheDocument();
  });
});
