import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CreateAgentForm } from "@/features/agents/CreateAgentForm";
import { AGENT_BLUEPRINT_DRAFT_KEY, serializeAgentBlueprintDraft } from "@/features/agents/agent-blueprint";
import { AGENT_CREATE_REQUEST_KEY, serializeAgentCreateRequest } from "@/features/agents/agent-create-request";

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
    expect(window.sessionStorage.getItem(AGENT_CREATE_REQUEST_KEY)).toBeNull();
  });

  it("服务端未确认结果时保留原请求，明确允许核对或确认后修改", async () => {
    actionMock.mockResolvedValue({ ok: false, error: "暂时无法根据这段描述生成流程草稿，请换个说法再试一次" });
    await fillAndSubmit();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "暂时无法根据这段描述生成流程草稿，请换个说法再试一次",
    );
    expect(screen.getByRole("button", { name: "核对上次创建" })).toBeEnabled();
    expect(screen.getByLabelText("助手名称")).toBeDisabled();
    expect(window.sessionStorage.getItem(AGENT_CREATE_REQUEST_KEY)).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "放弃核对并继续修改" }));
    const dialog = screen.getByRole("dialog", { name: "放弃核对上次创建？" });
    expect(dialog).toHaveTextContent("可能产生另一位助手");
    await userEvent.click(within(dialog).getByRole("button", { name: "继续修改" }));
    expect(screen.getByRole("button", { name: "创建助手" })).toBeVisible();
    expect(screen.getByLabelText("助手名称")).toBeEnabled();
    expect(window.sessionStorage.getItem(AGENT_CREATE_REQUEST_KEY)).toBeNull();
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
  }, 15_000);

  it("完整工作说明可核对，超出共享契约上限时不误报可以创建", async () => {
    const user = userEvent.setup();
    render(<CreateAgentForm />);
    fireEvent.change(screen.getByLabelText("助手名称"), { target: { value: "售后助手" } });
    const objective = screen.getByLabelText(/想让助手完成什么/);
    fireEvent.change(objective, { target: { value: "工".repeat(1995) } });
    await user.click(screen.getByText("补充业务蓝图（推荐）"));
    fireEvent.change(screen.getByLabelText("什么时候开始"), { target: { value: "收到新工单后" } });
    expect(screen.getByText(/完整工作说明超出 \d+ 个字/)).toBeInTheDocument();
    expect(screen.getByText("完整说明过长，暂不能创建")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建助手" })).toBeDisabled();
    await user.click(screen.getByText("核对完整工作说明"));
    expect(screen.getByText(/触发条件：收到新工单后/)).toBeInTheDocument();
    expect(screen.getByText(/不是已生成的流程/)).toBeInTheDocument();
    expect(actionMock).not.toHaveBeenCalled();

    fireEvent.change(objective, { target: { value: "收到新工单后整理资料并生成处理建议" } });
    expect(screen.queryByText(/完整工作说明超出 \d+ 个字/)).not.toBeInTheDocument();
    expect(screen.getByText("已经可以创建")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建助手" })).toBeEnabled();
  });

  it("创建请求中断时锁住原内容，沿用原请求标识核对", async () => {
    actionMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({
      ok: true,
      agentId: "00000000-0000-4000-8000-000000000009",
    });
    await fillAndSubmit();
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法确认助手是否已创建");
    expect(screen.getByLabelText("助手名称")).toBeDisabled();
    expect(screen.getByRole("button", { name: "核对上次创建" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "核对上次创建" }));
    await waitFor(() => expect(actionMock).toHaveBeenCalledTimes(2));
    expect(actionMock.mock.calls[1][1]).toBe(actionMock.mock.calls[0][1]);
  }, 15_000);

  it("浏览器无法保留请求时提醒保持页面打开", async () => {
    const realSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === AGENT_CREATE_REQUEST_KEY) throw new Error("storage unavailable");
      realSetItem.call(this, key, value);
    });
    actionMock.mockRejectedValue(new Error("offline"));
    await fillAndSubmit();
    expect(await screen.findByText(/浏览器未能保留本次请求/)).toBeVisible();
    expect(screen.getByRole("button", { name: "核对上次创建" })).toBeEnabled();
  });

  it("刷新后恢复待核对请求，继续使用原标识和原内容", async () => {
    const requestId = "00000000-0000-4000-8000-000000000099";
    window.sessionStorage.setItem(AGENT_CREATE_REQUEST_KEY, serializeAgentCreateRequest({
      requestId, name: "客服助手", intentText: INTENT_TEXT,
    }));
    actionMock.mockResolvedValue({ ok: true, agentId: requestId });
    render(<CreateAgentForm />);
    expect(await screen.findByRole("button", { name: "核对上次创建" })).toBeVisible();
    expect(screen.getByLabelText("助手名称")).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("已恢复上次创建请求");
    await userEvent.click(screen.getByRole("button", { name: "核对上次创建" }));
    await waitFor(() => expect(actionMock).toHaveBeenCalledWith({ name: "客服助手", intentText: INTENT_TEXT }, requestId));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/agents/${requestId}`));
    expect(window.sessionStorage.getItem(AGENT_CREATE_REQUEST_KEY)).toBeNull();
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
    render(<CreateAgentForm />);
    expect(await screen.findByDisplayValue("恢复助手")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("已恢复本标签页中未提交的业务蓝图");
    await userEvent.click(screen.getByRole("button", { name: "清空内容" }));
    await userEvent.click(screen.getByRole("button", { name: "确认清空" }));
    expect(screen.getByLabelText("助手名称")).toHaveValue("");
    expect(window.sessionStorage.getItem(AGENT_BLUEPRINT_DRAFT_KEY)).toBeNull();
  });
});
