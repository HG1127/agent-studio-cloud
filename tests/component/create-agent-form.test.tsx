import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateAgentForm } from "@/features/agents/CreateAgentForm";

const { actionMock, pushMock } = vi.hoisted(() => ({
  actionMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("@/server/actions/create-agent", () => ({ createAgentAction: actionMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

const INTENT_TEXT = "收到客户咨询后读取客户资料并生成回复方案，发送前由负责人确认，最后输出回复邮件";

async function fillAndSubmit() {
  const user = userEvent.setup();
  render(<CreateAgentForm />);
  await user.type(screen.getByLabelText("助手名称"), "客服助手");
  await user.type(screen.getByLabelText(/想让助手完成什么/), INTENT_TEXT);
  await user.click(screen.getByRole("button", { name: "创建助手" }));
}

describe("CreateAgentForm", () => {
  afterEach(() => {
    actionMock.mockReset();
    pushMock.mockReset();
  });

  it("提交时调用创建动作并携带表单值，成功后跳转详情页", async () => {
    actionMock.mockResolvedValue({ ok: true, agentId: "00000000-0000-4000-8000-000000000009" });
    await fillAndSubmit();
    await waitFor(() => {
      expect(actionMock).toHaveBeenCalledWith({ name: "客服助手", intentText: INTENT_TEXT });
    });
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/agents/00000000-0000-4000-8000-000000000009");
    });
  });

  it("创建失败时显示后端返回的可读错误并退出提交态", async () => {
    actionMock.mockResolvedValue({ ok: false, error: "暂时无法根据这段描述生成流程草稿，请换个说法再试一次" });
    await fillAndSubmit();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "暂时无法根据这段描述生成流程草稿，请换个说法再试一次",
    );
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "创建助手" })).toBeEnabled();
    });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("创建请求中断时显示网络错误并允许重试", async () => {
    actionMock.mockRejectedValue(new Error("offline"));
    await fillAndSubmit();
    expect(await screen.findByRole("alert")).toHaveTextContent("创建请求失败，请检查网络后重试");
    expect(screen.getByRole("button", { name: "创建助手" })).toBeEnabled();
  });
});
