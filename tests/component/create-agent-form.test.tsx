import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateAgentForm } from "@/features/agents/CreateAgentForm";
import { AGENT_BLUEPRINT_DRAFT_KEY, serializeAgentBlueprintDraft } from "@/features/agents/agent-blueprint";

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
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("提交时调用创建动作并携带表单值，成功后跳转详情页", async () => {
    actionMock.mockResolvedValue({ ok: true, agentId: "00000000-0000-4000-8000-000000000009" });
    await fillAndSubmit();
    await waitFor(() => {
      expect(actionMock).toHaveBeenCalledWith({ name: "客服助手", intentText: INTENT_TEXT }, expect.any(String));
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

  it("把可选业务蓝图并入需求后提交", async () => {
    actionMock.mockResolvedValue({ ok: true, agentId: "00000000-0000-4000-8000-000000000009" });
    const user = userEvent.setup();
    render(<CreateAgentForm />);
    await user.type(screen.getByLabelText("助手名称"), "售后助手");
    await user.type(screen.getByLabelText(/想让助手完成什么/), "收到售后问题后生成处理建议");
    await user.click(screen.getByText("补充业务蓝图（推荐）"));
    await user.type(screen.getByLabelText("什么时候开始"), "收到新工单后");
    await user.type(screen.getByLabelText("需要哪些资料"), "工单内容、客户等级");
    await user.type(screen.getByLabelText("最终要交付什么"), "回复邮件和处理记录");
    await user.type(screen.getByLabelText("有哪些限制"), "发送前必须由负责人确认");
    await user.click(screen.getByRole("button", { name: "创建助手" }));
    await waitFor(() => expect(actionMock).toHaveBeenCalledWith({
      name: "售后助手",
      intentText: [
        "收到售后问题后生成处理建议",
        "触发条件：收到新工单后",
        "需要的业务输入：工单内容、客户等级",
        "最终交付：回复邮件和处理记录",
        "必须遵守：发送前必须由负责人确认",
      ].join("\n"),
    }, expect.any(String)));
  });

  it("创建请求中断时显示网络错误并允许重试", async () => {
    actionMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({
      ok: true,
      agentId: "00000000-0000-4000-8000-000000000009",
    });
    await fillAndSubmit();
    expect(await screen.findByRole("alert")).toHaveTextContent("创建请求失败，请检查网络后重试");
    expect(screen.getByRole("button", { name: "创建助手" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "创建助手" }));
    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(2));
    expect(actionMock.mock.calls[1][1]).toBe(actionMock.mock.calls[0][1]);
  });

  it("连续提交时只创建一次助手", async () => {
    actionMock.mockImplementation(() => new Promise(() => undefined));
    const user = userEvent.setup();
    render(<CreateAgentForm />);
    await user.type(screen.getByLabelText("助手名称"), "客服助手");
    await user.type(screen.getByLabelText(/想让助手完成什么/), INTENT_TEXT);
    const form = screen.getByRole("button", { name: "创建助手" }).closest("form")!;

    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(actionMock).toHaveBeenCalledOnce());
  });

  it("恢复当前标签页未提交的业务蓝图并可主动清空", async () => {
    window.sessionStorage.setItem(AGENT_BLUEPRINT_DRAFT_KEY, serializeAgentBlueprintDraft({
      name: "恢复助手",
      objective: "恢复一段尚未提交的完整业务目标",
      trigger: "收到消息后",
      inputs: "消息内容",
      outputs: "处理结果",
      constraints: "不得泄露隐私",
    }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<CreateAgentForm />);
    expect(await screen.findByDisplayValue("恢复助手")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已恢复本标签页中未提交的业务蓝图");
    await userEvent.click(screen.getByRole("button", { name: "清空内容" }));
    expect(screen.getByLabelText("助手名称")).toHaveValue("");
    expect(window.sessionStorage.getItem(AGENT_BLUEPRINT_DRAFT_KEY)).toBeNull();
  });
});
