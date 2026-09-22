// RunLauncher 组件测试：默认空对象输入、非法 JSON 拦截（不发请求）、合法输入启动并跳转、
// 启动失败展示动作返回的中文错误。
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunLauncher } from "@/features/agents/run-launcher";

const { startRunMock, pushMock } = vi.hoisted(() => ({
  startRunMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("@/server/actions/start-run", () => ({ startRunAction: startRunMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

const AGENT_ID = "5a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d";
const RUN_ID = "3f0d2c9e-8a7b-4c1d-9e2f-1a2b3c4d5e6f";

// JSON 文本含 {}[] 等按键修饰符，改用 change 事件直接设值
function fillInput(value: string) {
  fireEvent.change(screen.getByLabelText("运行输入（JSON）"), { target: { value } });
}

describe("RunLauncher", () => {
  afterEach(() => {
    startRunMock.mockReset();
    pushMock.mockReset();
  });

  it("渲染运行入口，输入默认为空对象", () => {
    render(<RunLauncher agentId={AGENT_ID} />);
    expect(screen.getByRole("button", { name: "运行此助手" })).toBeInTheDocument();
    expect(screen.getByLabelText("运行输入（JSON）")).toHaveValue("{}");
  });

  it("非法 JSON 提示中文错误且不发请求", async () => {
    const user = userEvent.setup();
    render(<RunLauncher agentId={AGENT_ID} />);
    fillInput("{bad");
    await user.click(screen.getByRole("button", { name: "运行此助手" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请输入正确的 JSON 格式");
    expect(startRunMock).not.toHaveBeenCalled();
  });

  it("非对象 JSON（数组）同样拦截", async () => {
    const user = userEvent.setup();
    render(<RunLauncher agentId={AGENT_ID} />);
    fillInput("[1,2]");
    await user.click(screen.getByRole("button", { name: "运行此助手" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请输入正确的 JSON 格式");
    expect(startRunMock).not.toHaveBeenCalled();
  });

  it("合法输入调用运行动作并跳转到运行详情", async () => {
    startRunMock.mockResolvedValue({ ok: true, runId: RUN_ID });
    const user = userEvent.setup();
    render(<RunLauncher agentId={AGENT_ID} />);
    fillInput('{"question":"物流几天到"}');
    await user.click(screen.getByRole("button", { name: "运行此助手" }));
    await waitFor(() => {
      expect(startRunMock).toHaveBeenCalledWith({ agentId: AGENT_ID, input: { question: "物流几天到" } });
    });
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith(`/runs/${RUN_ID}`);
    });
  });

  it("启动失败展示动作返回的中文错误且不跳转", async () => {
    startRunMock.mockResolvedValue({ ok: false, error: "这个助手还没有发布版本，请先发布后再运行" });
    const user = userEvent.setup();
    render(<RunLauncher agentId={AGENT_ID} />);
    await user.click(screen.getByRole("button", { name: "运行此助手" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("这个助手还没有发布版本，请先发布后再运行");
    expect(pushMock).not.toHaveBeenCalled();
  });
});
