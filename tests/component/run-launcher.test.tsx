// RunLauncher 组件测试：默认空对象输入、非法 JSON 拦截（不发请求）、合法输入启动并跳转、
// 启动失败展示动作返回的中文错误。
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunLauncher } from "@/features/agents/RunLauncher";

const { startRunMock, pushMock } = vi.hoisted(() => ({
  startRunMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("@/server/actions/start-run", () => ({ startRunAction: startRunMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

const AGENT_ID = "5a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";
const RUN_ID = "3f0d2c9e-8a7b-4c1d-9e2f-1a2b3c4d5e6f";
const REQUEST_ID = "00000000-0000-4000-8000-000000000099";

// JSON 文本含 {}[] 等按键修饰符，改用 change 事件直接设值
function fillInput(value: string) {
  fireEvent.change(screen.getByLabelText("运行输入（对象格式）"), { target: { value } });
}

describe("RunLauncher", () => {
  beforeEach(() => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(REQUEST_ID);
  });

  afterEach(() => {
    startRunMock.mockReset();
    pushMock.mockReset();
    vi.restoreAllMocks();
  });

  it("渲染运行入口，输入默认为空对象", () => {
    render(<RunLauncher agentId={AGENT_ID} />);
    expect(screen.getByRole("button", { name: "开始试运行" })).toBeInTheDocument();
    expect(screen.getByLabelText("运行输入（对象格式）")).toHaveValue("{}");
    expect(screen.getByRole("complementary", { name: "本次运行说明" })).toHaveTextContent("固定使用当前正式版本");
  });

  it("用正式版本契约预览交付，不把未命名的内部路径展示给员工", () => {
    render(<RunLauncher agentId={AGENT_ID} outputFields={[
      { path: "result.report", label: "经营简报", required: true },
      { path: "internal_output_2", required: false },
    ]} />);
    const summary = screen.getByRole("complementary", { name: "本次运行说明" });
    expect(summary).toHaveTextContent("完成后可查看与复制");
    expect(summary).toHaveTextContent("经营简报");
    expect(summary).toHaveTextContent("交付内容 2");
    expect(summary).not.toHaveTextContent("internal_output_2");
  });

  it("没有正式版本时阻止无效运行并引导前往发布", () => {
    render(<RunLauncher agentId={AGENT_ID} hasProductionVersion={false} />);
    expect(screen.getByText("尚无正式版本")).toBeVisible();
    expect(screen.getByRole("link", { name: "前往版本发布" })).toHaveAttribute("href", "#versions");
    expect(screen.queryByRole("button", { name: "开始试运行" })).not.toBeInTheDocument();
    expect(startRunMock).not.toHaveBeenCalled();
  });

  it("已发布版本没有声明字段时仍提供通用输入入口", async () => {
    startRunMock.mockResolvedValue({ ok: true, runId: RUN_ID });
    const user = userEvent.setup();
    render(<RunLauncher agentId={AGENT_ID} inputFields={[]} />);
    expect(screen.getByLabelText("运行输入（对象格式）")).toHaveValue("{}");
    fillInput('{"question":"请生成本周报告"}');
    await user.click(screen.getByRole("button", { name: "开始试运行" }));
    await waitFor(() => expect(startRunMock).toHaveBeenCalledWith({
      agentId: AGENT_ID,
      input: { question: "请生成本周报告" },
      requestId: REQUEST_ID,
    }));
  });

  it("非法 JSON 提示中文错误且不发请求", async () => {
    const user = userEvent.setup();
    render(<RunLauncher agentId={AGENT_ID} />);
    fillInput("{bad");
    await user.click(screen.getByRole("button", { name: "开始试运行" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请输入正确的 JSON 格式");
    expect(startRunMock).not.toHaveBeenCalled();
  });

  it("非对象 JSON（数组）同样拦截", async () => {
    const user = userEvent.setup();
    render(<RunLauncher agentId={AGENT_ID} />);
    fillInput("[1,2]");
    await user.click(screen.getByRole("button", { name: "开始试运行" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请输入正确的 JSON 格式");
    expect(startRunMock).not.toHaveBeenCalled();
  });

  it("合法输入调用运行动作并跳转到运行详情", async () => {
    startRunMock.mockResolvedValue({ ok: true, runId: RUN_ID });
    const user = userEvent.setup();
    render(<RunLauncher agentId={AGENT_ID} />);
    fillInput('{"question":"物流几天到"}');
    await user.click(screen.getByRole("button", { name: "开始试运行" }));
    await waitFor(() => {
      expect(startRunMock).toHaveBeenCalledWith({
        agentId: AGENT_ID,
        input: { question: "物流几天到" },
        requestId: REQUEST_ID,
      });
    });
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith(`/runs/${RUN_ID}`);
    });
  });

  it("启动失败展示动作返回的中文错误且不跳转", async () => {
    startRunMock.mockResolvedValue({ ok: false, error: "这个助手还没有发布版本，请先发布后再运行" });
    const user = userEvent.setup();
    render(<RunLauncher agentId={AGENT_ID} />);
    await user.click(screen.getByRole("button", { name: "开始试运行" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("这个助手还没有发布版本，请先发布后再运行");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("启动请求中断时锁定原输入，并提供安全核对与记录入口", async () => {
    startRunMock.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    render(<RunLauncher agentId={AGENT_ID} />);
    fillInput('{"question":"请处理合同"}');
    await user.click(screen.getByRole("button", { name: "开始试运行" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法确认是否已创建运行");
    expect(screen.getByLabelText("运行输入（对象格式）")).toBeDisabled();
    expect(screen.getByRole("button", { name: "核对上次启动" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "查看这位助手的运行记录" })).toHaveAttribute("href", `/runs?agent=${AGENT_ID}`);
  });

  it("网络中断后重试复用请求标识", async () => {
    startRunMock.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({ ok: true, runId: RUN_ID });
    const user = userEvent.setup();
    render(<RunLauncher agentId={AGENT_ID} />);

    await user.click(screen.getByRole("button", { name: "开始试运行" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "核对上次启动" }));

    await waitFor(() => expect(startRunMock).toHaveBeenCalledTimes(2));
    expect(startRunMock.mock.calls[0]?.[0].requestId).toBe(REQUEST_ID);
    expect(startRunMock.mock.calls[1]?.[0].requestId).toBe(REQUEST_ID);
    expect(startRunMock.mock.calls[1]?.[0].input).toEqual(startRunMock.mock.calls[0]?.[0].input);
    expect(pushMock).toHaveBeenCalledWith(`/runs/${RUN_ID}`);
  });

  it("核对得到明确失败时解除输入锁定", async () => {
    startRunMock.mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce({ ok: false, error: "当前正式版本不可用" });
    const user = userEvent.setup();
    render(<RunLauncher agentId={AGENT_ID} />);

    await user.click(screen.getByRole("button", { name: "开始试运行" }));
    await screen.findByRole("button", { name: "核对上次启动" });
    await user.click(screen.getByRole("button", { name: "核对上次启动" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("当前正式版本不可用");
    expect(screen.getByLabelText("运行输入（对象格式）")).toBeEnabled();
    expect(screen.getByRole("button", { name: "开始试运行" })).toBeEnabled();
  });

  it("连续点击只发起一次运行", async () => {
    startRunMock.mockImplementation(() => new Promise(() => undefined));
    render(<RunLauncher agentId={AGENT_ID} />);
    const button = screen.getByRole("button", { name: "开始试运行" });

    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => expect(startRunMock).toHaveBeenCalledOnce());
  });

  it("按版本输入契约生成字段并在提交前校验必填项", async () => {
    startRunMock.mockResolvedValue({ ok: true, runId: RUN_ID });
    const user = userEvent.setup();
    render(<RunLauncher agentId={AGENT_ID} inputFields={[
      { name: "brief", label: "任务说明", required: true, type: "string" },
      { name: "count", label: "数量", required: false, type: "number" },
    ]} />);
    await user.click(screen.getByRole("button", { name: "开始试运行" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请填写任务说明");
    expect(startRunMock).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("任务说明（必填）"), "生成续约方案");
    await user.type(screen.getByLabelText("数量（选填）"), "2");
    await user.click(screen.getByRole("button", { name: "开始试运行" }));
    await waitFor(() => expect(startRunMock).toHaveBeenCalledWith({
      agentId: AGENT_ID,
      input: { brief: "生成续约方案", count: 2 },
      requestId: REQUEST_ID,
    }));
  });

  it("缺少中文字段名称时使用中性序号，不显示内部字段名", async () => {
    const user = userEvent.setup();
    render(<RunLauncher agentId={AGENT_ID} inputFields={[
      { name: "internal_payload", required: true, type: "string" },
    ]} />);
    expect(screen.getByLabelText("业务信息 1（必填）")).toBeVisible();
    expect(screen.queryByText("internal_payload")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "开始试运行" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请填写业务信息 1");
    expect(startRunMock).not.toHaveBeenCalled();
  });
});
