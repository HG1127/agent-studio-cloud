import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpConnectionDesignDraft } from "@/features/connections/McpConnectionDesignDraft";
import { DRAFT_STATE_EVENT, type DraftStateDetail } from "@/lib/draft-state";

const io = { network: vi.fn(), storage: vi.fn(), popup: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", io.network);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(io.storage);
  vi.spyOn(window, "open").mockImplementation(io.popup);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function fillConnection(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole("textbox", { name: "连接名称" }), "业务外部服务");
  await user.type(screen.getByRole("textbox", { name: "服务地址" }), "https://tools.example.test/bridge");
  await user.selectOptions(screen.getByRole("combobox", { name: "认证方式设计" }), "none");
}

describe("真实连接设计组件的本页交互", () => {
  it("隐藏的超长认证引用不阻断所选方案，重新选择后保留并聚焦错误", async () => {
    const user = userEvent.setup();
    render(<McpConnectionDesignDraft />);
    await fillConnection(user);
    await user.selectOptions(screen.getByRole("combobox", { name: "认证方式设计" }), "credential");
    const reference = screen.getByRole("textbox", { name: "服务端凭据名称引用" });
    const longReference = "C".repeat(201);
    fireEvent.change(reference, { target: { value: longReference } });
    await user.selectOptions(screen.getByRole("combobox", { name: "认证方式设计" }), "none");
    await user.click(screen.getByRole("button", { name: "检查草稿" }));
    expect(screen.getByRole("status")).toHaveTextContent("当前启用方案");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "认证方式设计" }), "credential");
    await user.click(screen.getByRole("button", { name: "检查草稿" }));
    const restored = screen.getByRole("textbox", { name: "服务端凭据名称引用" });
    expect(restored).toHaveValue(longReference);
    expect(restored).toHaveFocus();
    expect(restored).toHaveAccessibleDescription("引用名称不能超过 200 字");
    expect(io.network).not.toHaveBeenCalled(); expect(io.storage).not.toHaveBeenCalled();
  });

  it("关闭业务边界不校验其隐藏错误，重新开启保留长正文并展开错误位置", async () => {
    const user = userEvent.setup();
    render(<McpConnectionDesignDraft />);
    await fillConnection(user);
    await user.click(screen.getByRole("checkbox", { name: "填写工具业务边界方案" }));
    await user.click(screen.getByText("展开业务边界填写"));
    const longName = "N".repeat(201);
    const longBehavior = "说".repeat(4001);
    fireEvent.change(screen.getByRole("textbox", { name: "员工看到的工具名称" }), { target: { value: longName } });
    fireEvent.change(screen.getByRole("textbox", { name: "它实际会做什么" }), { target: { value: longBehavior } });
    await user.click(screen.getByRole("checkbox", { name: "填写工具业务边界方案" }));
    await user.click(screen.getByRole("button", { name: "检查草稿" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("未启用的填写仅保留，未检查");
    await user.click(screen.getByRole("checkbox", { name: "填写工具业务边界方案" }));
    await user.click(screen.getByText("展开业务边界填写"));
    await user.click(screen.getByRole("button", { name: "检查草稿" }));
    const restored = screen.getByRole("textbox", { name: "员工看到的工具名称" });
    expect(restored).toHaveValue(longName); expect(restored).toHaveFocus();
    expect(restored.closest("details")).toHaveAttribute("open");
    expect(restored).toHaveAccessibleDescription("业务名称不能超过 200 字");
    expect(screen.getByRole("textbox", { name: "它实际会做什么" })).toHaveValue(longBehavior);
    expect(io.network).not.toHaveBeenCalled(); expect(io.storage).not.toHaveBeenCalled();
  });

  it("所有方案选择都可显式清空，清空不偷偷改为免认证或自动调用", async () => {
    const user = userEvent.setup();
    render(<McpConnectionDesignDraft />);
    await fillConnection(user);
    await user.selectOptions(screen.getByRole("combobox", { name: "认证方式设计" }), "");
    expect(screen.getByRole("combobox", { name: "认证方式设计" })).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "检查草稿" }));
    expect(screen.getByRole("combobox", { name: "认证方式设计" })).toHaveFocus();
    expect(screen.getByRole("combobox", { name: "认证方式设计" })).toHaveAccessibleDescription("请选择认证方式设计");
    await user.selectOptions(screen.getByRole("combobox", { name: "认证方式设计" }), "none");
    await user.click(screen.getByRole("checkbox", { name: "填写工具业务边界方案" }));
    await user.click(screen.getByText("展开业务边界填写"));
    for (const [name, value] of [["读写类型设计", "read"], ["风险等级设计", "high"], ["运行策略设计", "approval_required"]]) {
      const control = screen.getByRole("combobox", { name });
      await user.selectOptions(control, value);
      await user.selectOptions(control, "");
      expect(control).toHaveValue("");
    }
    expect(io.network).not.toHaveBeenCalled(); expect(io.storage).not.toHaveBeenCalled();
  });

  it("初始空白，不自动联网或持久化，未接能力禁用且不生成账号和工具记录", async () => {
    const user = userEvent.setup();
    const view = render(<McpConnectionDesignDraft />);
    expect(screen.getByRole("textbox", { name: "连接名称" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "服务地址" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "认证方式设计" })).toHaveValue("");
    expect(screen.getByLabelText("实际访问密钥")).toBeDisabled();
    expect(screen.getByLabelText("实际访问密钥")).toHaveValue("");
    for (const name of ["保存连接（待接入）", "连接测试（待接入）", "发现工具（待接入）", "账号授权（待接入）"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeDisabled(); await user.click(button);
    }
    expect(view.container.textContent).not.toMatch(/MCP|workspace|available/);
    expect(screen.queryByText("已连接", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText("已保存", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText("仅来自当前本页填写，不是已连接记录。")).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(io.network).not.toHaveBeenCalled(); expect(io.storage).not.toHaveBeenCalled(); expect(io.popup).not.toHaveBeenCalled();
  });

  it("错误聚焦名称并关联中文说明，保护地址校验不请求用户地址", async () => {
    const user = userEvent.setup();
    render(<McpConnectionDesignDraft />);
    await user.click(screen.getByRole("button", { name: "检查草稿" }));
    const name = screen.getByRole("textbox", { name: "连接名称" });
    expect(name).toHaveFocus(); expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("请填写连接名称");
    await user.type(name, "未提交设计");
    await user.type(screen.getByRole("textbox", { name: "服务地址" }), "https://tools.example.test?region=test");
    await user.selectOptions(screen.getByRole("combobox", { name: "认证方式设计" }), "none");
    await user.click(screen.getByRole("button", { name: "检查草稿" }));
    expect(screen.getByRole("textbox", { name: "服务地址" })).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "服务地址" })).toHaveAccessibleDescription(/不含账号密码、查询参数或片段/);
    expect(screen.getByRole("textbox", { name: "服务地址" })).toHaveValue("https://tools.example.test?region=test");
    expect(screen.getByText(/这不是服务端全部协议的限制声明/)).toBeVisible();
    expect(io.network).not.toHaveBeenCalled();
  });

  it("认证引用保留不同方案填写，疑似密钥值不接收，折叠请求头错误自动展开聚焦", async () => {
    const user = userEvent.setup();
    render(<McpConnectionDesignDraft />);
    await fillConnection(user);
    await user.selectOptions(screen.getByRole("combobox", { name: "认证方式设计" }), "credential");
    const reference = screen.getByRole("textbox", { name: "服务端凭据名称引用" });
    await user.type(reference, "TEAM_SERVICE_CREDENTIAL");
    fireEvent.change(reference, { target: { value: "Bearer local-test-not-a-real-key" } });
    expect(reference).toHaveValue("TEAM_SERVICE_CREDENTIAL");
    expect(reference).toHaveAccessibleDescription(/疑似凭据值，本页未接收/);
    await user.click(screen.getByRole("button", { name: "检查草稿" }));
    const header = screen.getByRole("textbox", { name: "认证请求头名称" });
    expect(header).toHaveFocus(); expect(header.closest("details")).toHaveAttribute("open");
    expect(header).toHaveAccessibleDescription(/合法认证请求头名称/);
    await user.type(header, "Authorization");
    await user.selectOptions(screen.getByRole("combobox", { name: "认证方式设计" }), "account");
    await user.type(screen.getByRole("textbox", { name: "已有账号授权名称引用" }), "团队已有授权名称");
    expect(screen.getByText(/当前未读取账号授权目录/)).toBeVisible();
    await user.selectOptions(screen.getByRole("combobox", { name: "认证方式设计" }), "credential");
    expect(screen.getByRole("textbox", { name: "服务端凭据名称引用" })).toHaveValue("TEAM_SERVICE_CREDENTIAL");
    await user.click(screen.getByText("认证请求设置（维护人员）"));
    expect(screen.getByRole("textbox", { name: "认证请求头名称" })).toHaveValue("Authorization");
    await user.selectOptions(screen.getByRole("combobox", { name: "认证方式设计" }), "account");
    expect(screen.getByRole("textbox", { name: "已有账号授权名称引用" })).toHaveValue("团队已有授权名称");
    expect(screen.getByLabelText("实际访问密钥")).toHaveValue("");
    expect(io.network).not.toHaveBeenCalled(); expect(io.storage).not.toHaveBeenCalled(); expect(io.popup).not.toHaveBeenCalled();
  });

  it("业务边界跨折叠错误聚焦，高风险移除自动方案且标签始终待核验", async () => {
    const user = userEvent.setup();
    render(<McpConnectionDesignDraft />);
    await fillConnection(user);
    await user.click(screen.getByRole("checkbox", { name: "填写工具业务边界方案" }));
    await user.click(screen.getByRole("button", { name: "检查草稿" }));
    const businessName = screen.getByRole("textbox", { name: "员工看到的工具名称" });
    expect(businessName).toHaveFocus(); expect(businessName.closest("details")).toHaveAttribute("open");
    await user.type(businessName, "业务记录查询");
    await user.type(screen.getByRole("textbox", { name: "它实际会做什么" }), "读取业务记录，不写入；返回查询记录。");
    await user.type(screen.getByRole("textbox", { name: "待核验能力标签" }), "读取业务记录");
    await user.selectOptions(screen.getByRole("combobox", { name: "读写类型设计" }), "read");
    await user.selectOptions(screen.getByRole("combobox", { name: "风险等级设计" }), "low");
    await user.selectOptions(screen.getByRole("combobox", { name: "运行策略设计" }), "automatic_allowed");
    await user.selectOptions(screen.getByRole("combobox", { name: "风险等级设计" }), "high");
    expect(screen.getByRole("combobox", { name: "运行策略设计" })).toHaveValue("approval_required");
    expect(screen.getByRole("option", { name: "按已发布流程自动调用（方案）" })).toBeDisabled();
    expect(screen.getByText("能力标签均待核验")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "检查草稿" }));
    expect(screen.getByRole("status")).toHaveTextContent("能力是否属实均未核验");
    expect(screen.queryByRole("checkbox", { name: /已核验/ })).not.toBeInTheDocument();
    expect(io.network).not.toHaveBeenCalled();
  });

  it("检查不清除dirty，撤销确认只恢复本页检查点，取消保留新填写", async () => {
    const user = userEvent.setup();
    render(<McpConnectionDesignDraft />);
    await fillConnection(user);
    await user.click(screen.getByRole("button", { name: "检查草稿" }));
    expect(screen.getByText("有未保存的本页填写")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("尚未保存、连接、发现或授权");
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
    await user.type(screen.getByRole("textbox", { name: "连接名称" }), "修改");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText(/检查点之后有新修改/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "撤销到本页检查点" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "返回" }));
    expect(screen.getByRole("textbox", { name: "连接名称" })).toHaveValue("业务外部服务修改");
    await user.click(screen.getByRole("button", { name: "撤销到本页检查点" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "恢复本页检查点" }));
    expect(screen.getByRole("textbox", { name: "连接名称" })).toHaveValue("业务外部服务");
    expect(screen.getByRole("button", { name: "撤销到本页检查点" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("没有还原或修改服务器配置");
    await waitFor(() => expect(screen.getByRole("button", { name: "检查草稿" })).toHaveFocus());
    expect(io.network).not.toHaveBeenCalled(); expect(io.storage).not.toHaveBeenCalled();
  });

  it("清空取消保留完整长名称、确认后回原按钮，不改变真实目录或留秘密字段", async () => {
    const user = userEvent.setup();
    render(<McpConnectionDesignDraft />);
    const longName = "N".repeat(200);
    fireEvent.change(screen.getByRole("textbox", { name: "连接名称" }), { target: { value: longName } });
    expect(screen.getByRole("heading", { name: longName })).toHaveClass("break-words");
    await user.click(screen.getByRole("button", { name: "清空草稿" }));
    const description = within(screen.getByRole("dialog")).getByText("将清空「" + longName + "」的本页填写和检查点，不删除、停用或更改真实连接目录。");
    expect(description).toHaveClass("break-words");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "返回" }));
    expect(screen.getByRole("textbox", { name: "连接名称" })).toHaveValue(longName);
    await user.click(screen.getByRole("button", { name: "清空草稿" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "清空本页草稿" }));
    expect(screen.getByRole("textbox", { name: "连接名称" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "服务地址" })).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("真实连接目录未改变");
    await waitFor(() => expect(screen.getByRole("button", { name: "清空草稿" })).toHaveFocus());
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(false);
    expect(io.network).not.toHaveBeenCalled(); expect(io.storage).not.toHaveBeenCalled();
  });

  it("失败保留上次检查点和多行正文，关闭边界再开不删除其填写", async () => {
    const user = userEvent.setup();
    render(<McpConnectionDesignDraft />);
    await fillConnection(user);
    await user.click(screen.getByRole("button", { name: "检查草稿" }));
    await user.click(screen.getByRole("checkbox", { name: "填写工具业务边界方案" }));
    await user.click(screen.getByText("展开业务边界填写"));
    await user.type(screen.getByRole("textbox", { name: "它实际会做什么" }), "第一行业务行为\n第二行回执说明");
    await user.click(screen.getByRole("button", { name: "检查草稿" }));
    expect(screen.getByRole("alert")).toHaveTextContent("此前检查点均保留");
    expect(screen.getByRole("button", { name: "撤销到本页检查点" })).toBeEnabled();
    await user.click(screen.getByRole("checkbox", { name: "填写工具业务边界方案" }));
    await user.click(screen.getByRole("checkbox", { name: "填写工具业务边界方案" }));
    expect(screen.getByRole("textbox", { name: "它实际会做什么" })).toHaveValue("第一行业务行为\n第二行回执说明");
    expect(io.network).not.toHaveBeenCalled();
  });

  it("卸载只清自己的草稿登记，其余实例与离页保护保持", async () => {
    const user = userEvent.setup();
    const events: DraftStateDetail[] = [];
    const listener = (event: Event) => { events.push((event as CustomEvent<DraftStateDetail>).detail); };
    window.addEventListener(DRAFT_STATE_EVENT, listener);
    const view = render(<div><McpConnectionDesignDraft key="first" /><McpConnectionDesignDraft key="second" /></div>);
    try {
      const instances = screen.getAllByRole("region", { name: "连接设计草稿" });
      await user.type(within(instances[0]).getByRole("textbox", { name: "连接名称" }), "第一份设计");
      await user.type(within(instances[1]).getByRole("textbox", { name: "连接名称" }), "第二份设计");
      await user.click(within(instances[1]).getByRole("button", { name: "检查草稿" }));
      const firstAddress = within(instances[0]).getByRole("textbox", { name: "服务地址" });
      const secondAddress = within(instances[1]).getByRole("textbox", { name: "服务地址" });
      expect(secondAddress).toHaveFocus();
      expect(firstAddress).not.toHaveFocus();
      expect(secondAddress).toHaveAccessibleDescription("请填写服务地址");
      expect(within(instances[0]).queryByRole("alert")).not.toBeInTheDocument();
      expect(within(instances[0]).getByRole("textbox", { name: "连接名称" })).toHaveValue("第一份设计");
      const keys = events.filter((event) => event.dirty).map((event) => event.agentId);
      expect(new Set(keys).size).toBe(2);
      const firstKey = keys[0], secondKey = keys[keys.length - 1];
      events.length = 0;
      view.rerender(<div><McpConnectionDesignDraft key="second" /></div>);
      expect(events).toContainEqual({ agentId: firstKey, dirty: false });
      expect(events).not.toContainEqual({ agentId: secondKey, dirty: false });
      expect(screen.getByRole("textbox", { name: "连接名称" })).toHaveValue("第二份设计");
      expect(screen.getByRole("textbox", { name: "服务地址" })).toHaveAccessibleDescription("请填写服务地址");
      const unload = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
      view.unmount();
      expect(events).toContainEqual({ agentId: secondKey, dirty: false });
    } finally { view.unmount(); window.removeEventListener(DRAFT_STATE_EVENT, listener); }
  });
});
