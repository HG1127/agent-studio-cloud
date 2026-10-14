import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTargetOption } from "@/contracts/agent";
import { notifyDraftState } from "@/lib/draft-state";
import { WebToolDesignStudio } from "@/features/web-tools/WebToolDesignStudio";
import { WebToolsWorkspace } from "@/features/web-tools/WebToolsWorkspace";
import { WebToolLayoutPreview } from "@/features/web-tools/WebToolLayoutPreview";
import { createWebToolDesignDraft, designFieldsFromTarget } from "@/features/web-tools/web-tool-design-draft";

const io = vi.hoisted(() => ({ list: vi.fn(), manage: vi.fn(), keys: vi.fn(), read: vi.fn(), call: vi.fn(), receipt: vi.fn() }));
vi.mock("@/lib/draft-state", () => ({ notifyDraftState: vi.fn() }));
vi.mock("@/server/actions/public-agent-tools", () => ({
  listPublicToolsAction: io.list, managePublicToolAction: io.manage, readPublicToolAction: io.read,
  callPublicToolAction: io.call, readPublicToolCallAction: io.receipt,
}));
vi.mock("@/server/actions/read-public-tool-keys", () => ({ readPublicToolKeysAction: io.keys }));

const target = AgentTargetOption.parse({ agentId: "11111111-1111-4111-8111-111111111111", agentName: "业务报告助手",
  versionId: "22222222-2222-4222-8222-222222222222", version: 2,
  inputContract: { fields: [{ name: "business_text", label: "业务正文", required: true, type: "string" },
    { name: "quantity", label: "数量", required: false, type: "number" }] }, outputContract: { fields: [] } });

async function nameAndInputs(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole("textbox", { name: "工具展示名称" }), "业务网页工具");
  await user.click(screen.getByRole("button", { name: "2. 输入项" }));
}

beforeEach(() => { vi.clearAllMocks(); });

describe("网页工具页面设计与真实管理分区", () => {
  it("两份实际设计的错误焦点相互隔离，检查另一份不会丢失原填写", async () => {
    const user = userEvent.setup();
    render(<div>
      <section aria-label="第一份设计"><WebToolDesignStudio targets={[]} /></section>
      <section aria-label="第二份设计"><WebToolDesignStudio targets={[]} /></section>
    </div>);
    const first = within(screen.getByRole("region", { name: "第一份设计" }));
    const second = within(screen.getByRole("region", { name: "第二份设计" }));
    const firstName = first.getByRole("textbox", { name: "工具展示名称" });
    const secondName = second.getByRole("textbox", { name: "工具展示名称" });
    await user.type(firstName, "保留第一份填写");
    await user.click(second.getByRole("button", { name: "4. 访问与发布" }));
    expect(secondName).toHaveFocus();
    expect(firstName).not.toHaveFocus();
    expect(firstName).toHaveValue("保留第一份填写");
    expect(second.getByRole("alert")).toHaveTextContent("请填写不超过 200 字的工具名称");
    expect(first.queryByRole("alert")).not.toBeInTheDocument();
    await user.type(secondName, "独立的第二份填写");
    expect(firstName).toHaveValue("保留第一份填写");
    expect(secondName).toHaveValue("独立的第二份填写");
    for (const action of [io.list, io.manage, io.keys, io.read, io.call, io.receipt]) expect(action).not.toHaveBeenCalled();
  });

  it("默认挂载真实管理来源，分区切换保留两边填写且未调用保存接口", async () => {
    const user = userEvent.setup();
    render(<WebToolsWorkspace targets={[target]} />);
    expect(screen.getByRole("heading", { name: "把正式助手开放为网页工具" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "工具管理" })).toHaveAttribute("aria-selected", "true");
    const managementCredential = "test-only-management-credential-not-production";
    await user.type(screen.getByLabelText("管理凭据"), managementCredential);
    await user.click(screen.getByRole("button", { name: "定义新工具" }));
    await user.type(screen.getByRole("textbox", { name: "工具名称" }), "尚未提交");
    await user.click(screen.getByRole("tab", { name: "页面设计" }));
    expect(screen.getByRole("option", { name: "业务报告助手 · 第 2 版" })).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "工具展示名称" }), "未保存设计");
    await user.click(screen.getByRole("tab", { name: "工具管理" }));
    expect(screen.getByLabelText("管理凭据")).toHaveValue(managementCredential);
    expect(screen.getByRole("textbox", { name: "工具名称" })).toHaveValue("尚未提交");
    await user.click(screen.getByRole("tab", { name: "页面设计" }));
    expect(screen.getByRole("textbox", { name: "工具展示名称" })).toHaveValue("未保存设计");
    expect(screen.getByRole("button", { name: "保存页面配置（待接入）" })).toBeDisabled();
    expect(screen.getByText(/没有写入浏览器存储、服务器或已发布工具/)).toBeVisible();
    for (const action of [io.list, io.manage, io.keys, io.read, io.call, io.receipt]) expect(action).not.toHaveBeenCalled();
  });

  it("空白草稿前进回到需要填写的步骤，不能冒草稿检查通过", async () => {
    const user = userEvent.setup();
    render(<WebToolDesignStudio targets={[]} />);
    await user.click(screen.getByRole("button", { name: "4. 访问与发布" }));
    expect(screen.getByRole("button", { name: "1. 基本信息" })).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("alert")).toHaveTextContent("请填写不超过 200 字的工具名称");
    expect(screen.getByRole("textbox", { name: "工具展示名称" })).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "工具展示名称" })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("textbox", { name: "工具展示名称" })).toHaveAttribute("aria-describedby", screen.getByRole("alert").id);
    expect(screen.getByText(/尚无可选择的正式助手版本/)).toBeVisible();
    expect(screen.queryByText("本页草稿检查完成，尚未保存或发布。")).not.toBeInTheDocument();
  });

  it("读取失败与空列表不同，仍可手动编辑并且不替换已选版本", async () => {
    const user = userEvent.setup();
    const view = render(<WebToolDesignStudio targets={[target]} />);
    await user.type(screen.getByRole("textbox", { name: "工具展示名称" }), "保留的设计");
    await user.selectOptions(screen.getByRole("combobox", { name: "关联正式助手版本" }), target.versionId);
    view.rerender(<WebToolDesignStudio targets={null} />);
    expect(screen.getByText(/正式助手读取失败，仍可设计页面/)).toBeVisible();
    expect(screen.getByRole("combobox", { name: "关联正式助手版本" })).toHaveValue(target.versionId);
    await user.click(screen.getByRole("button", { name: "2. 输入项" }));
    expect(screen.getByRole("button", { name: "按正式输入生成表单" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "添加输入项" }));
    expect(screen.getByRole("textbox", { name: "显示名称" })).toHaveValue("新输入项");
    await user.click(screen.getByRole("button", { name: "检查草稿" }));
    expect(screen.getAllByRole("alert").some((notice) => notice.textContent?.includes("当前无法核对所选版本"))).toBe(true);
    expect(screen.getByRole("textbox", { name: "工具展示名称" })).toHaveValue("保留的设计");
  });

  it("真实契约字段生成前确认，取消保留表单，确认读取真实字段不生成业务样本", async () => {
    const user = userEvent.setup();
    render(<WebToolDesignStudio targets={[target]} />);
    await user.selectOptions(screen.getByRole("combobox", { name: "关联正式助手版本" }), target.versionId);
    await nameAndInputs(user);
    await user.click(screen.getByRole("button", { name: "添加输入项" }));
    await user.click(screen.getByRole("button", { name: "按正式输入生成表单" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "返回" }));
    expect(screen.getByRole("textbox", { name: "显示名称" })).toHaveValue("新输入项");
    await user.click(screen.getByRole("button", { name: "按正式输入生成表单" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "替换输入项" }));
    expect(screen.getAllByRole("textbox", { name: "显示名称" }).map((input) => (input as HTMLInputElement).value)).toEqual(["业务正文", "数量"]);
    expect(screen.getByRole("textbox", { name: "业务正文（必填）" })).toHaveValue("");
    expect(screen.getByRole("spinbutton", { name: "数量（选填）" })).toHaveValue(null);
    expect(screen.queryByRole("button", { name: /执行在线工具/ })).not.toBeInTheDocument();
  });

  it("输入项可完整编辑、选择类型必填、重排和确认移除，长名称不截断", async () => {
    const user = userEvent.setup();
    render(<WebToolDesignStudio targets={[]} />);
    await nameAndInputs(user);
    await user.click(screen.getByRole("button", { name: "添加输入项" }));
    const longName = "A".repeat(200);
    fireEvent.change(screen.getByRole("textbox", { name: "显示名称" }), { target: { value: longName } });
    await user.click(screen.getByRole("button", { name: "添加输入项" }));
    const groups = screen.getAllByRole("group", { name: /^输入项 \d+$/ });
    fireEvent.change(within(groups[1]).getByRole("textbox", { name: "显示名称" }), { target: { value: "是否确认" } });
    await user.selectOptions(within(groups[1]).getByRole("combobox", { name: "输入类型" }), "boolean");
    await user.click(within(groups[1]).getByRole("checkbox", { name: "设为必填" }));
    expect(screen.getByRole("combobox", { name: "是否确认（选填）" })).toBeVisible();
    const longLabel = screen.getByLabelText(longName + "（必填）").previousElementSibling;
    expect(longLabel).toHaveTextContent(longName);
    expect(longLabel).toHaveClass("break-words");
    await user.click(screen.getByRole("button", { name: "下移输入项 1" }));
    expect(screen.getAllByRole("textbox", { name: "显示名称" }).map((input) => (input as HTMLInputElement).value)).toEqual(["是否确认", longName]);
    await user.click(screen.getByRole("button", { name: "移除输入项 2" }));
    expect(within(screen.getByRole("dialog")).getByText("将从本页草稿移除「" + longName + "」，不会修改已发布工具。")).toHaveClass("break-words");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "返回" }));
    expect(screen.getAllByRole("textbox", { name: "显示名称" })).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "移除输入项 2" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "移除" }));
    expect(screen.getAllByRole("textbox", { name: "显示名称" })).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole("button", { name: "添加输入项" })).toHaveFocus());
  });

  it("模块和版式可调整，预览仅显示空布局，不填分数或业务结果", async () => {
    const user = userEvent.setup();
    render(<WebToolDesignStudio targets={[]} />);
    await user.type(screen.getByRole("textbox", { name: "工具展示名称" }), "结果页面");
    await user.click(screen.getByRole("button", { name: "3. 结果呈现" }));
    await user.click(screen.getByRole("button", { name: /^评分卡/ }));
    await user.click(screen.getByRole("button", { name: "添加结果模块" }));
    fireEvent.change(screen.getByRole("textbox", { name: "模块标题" }), { target: { value: "B".repeat(200) } });
    await user.selectOptions(screen.getByRole("combobox", { name: "展示方式" }), "ScoreCards");
    await user.click(screen.getByRole("button", { name: "添加结果模块" }));
    await user.click(screen.getByRole("button", { name: "下移结果模块 1" }));
    expect(screen.getAllByRole("textbox", { name: "模块标题" })[1]).toHaveValue("B".repeat(200));
    await user.click(screen.getByRole("tab", { name: "结果布局" }));
    expect(screen.getByLabelText("结果模块布局")).toHaveClass("grid-cols-2");
    expect(screen.getByText("B".repeat(200))).toHaveClass("break-words");
    expect(screen.getAllByText("真实运行后显示；当前仅为空布局。")).toHaveLength(2);
    const moduleGroup = screen.getAllByRole("group", { name: /^结果模块 \d+$/ })[1];
    await user.click(within(moduleGroup).getByRole("checkbox", { name: "显示此模块" }));
    expect(screen.queryByText("B".repeat(200))).not.toBeInTheDocument();
    expect(screen.queryByText(/综合评分：/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "移除结果模块 2" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "移除" }));
    expect(screen.getAllByRole("textbox", { name: "模块标题" })).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole("button", { name: "添加结果模块" })).toHaveFocus());
  });

  it("访问与上限只更新草稿，校验失败不声称授权或发布", async () => {
    const user = userEvent.setup();
    render(<WebToolDesignStudio targets={[]} />);
    await user.type(screen.getByRole("textbox", { name: "工具展示名称" }), "访问方案");
    await user.click(screen.getByRole("button", { name: "4. 访问与发布" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "谁可以使用" }), "domain_sites");
    await user.click(screen.getByRole("button", { name: "检查草稿" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请至少填写一个指定网站");
    await user.type(screen.getByRole("textbox", { name: "指定网站来源" }), "https://example.com/path");
    await user.click(screen.getByRole("button", { name: "检查草稿" }));
    expect(screen.getByRole("alert")).toHaveTextContent("不含路径");
    fireEvent.change(screen.getByRole("textbox", { name: "指定网站来源" }), { target: { value: "https://example.com" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "每天次数上限" }), { target: { value: "10" } });
    await user.click(screen.getByRole("button", { name: "检查草稿" }));
    expect(screen.getByRole("alert")).toHaveTextContent("每天上限不能小于每小时上限");
    fireEvent.change(screen.getByRole("spinbutton", { name: "每天次数上限" }), { target: { value: "100" } });
    await user.click(screen.getByRole("button", { name: "检查草稿" }));
    expect(screen.getByRole("status")).toHaveTextContent("尚未保存或发布");
    expect(screen.getByRole("button", { name: "保存页面配置（待接入）" })).toBeDisabled();
    await user.click(screen.getByRole("tab", { name: "接入说明" }));
    expect(screen.getByText(/不会生成可用链接、嵌入代码或统计数据/)).toBeVisible();
  });

  it("专业编辑有效应用与向导同步，无效不覆盖，未应用离开需确认", async () => {
    const user = userEvent.setup();
    render(<WebToolDesignStudio targets={[]} />);
    await user.type(screen.getByRole("textbox", { name: "工具展示名称" }), "原名称");
    await user.click(screen.getByRole("button", { name: "专业配置" }));
    const editor = screen.getByRole("textbox", { name: "本页设计结构" });
    const edited = JSON.parse((editor as HTMLTextAreaElement).value) as Record<string, unknown>;
    edited.name = "专业修改后的名称";
    fireEvent.change(editor, { target: { value: JSON.stringify(edited) } });
    await user.click(screen.getByRole("button", { name: "应用到本页草稿" }));
    expect(screen.getByRole("status")).toHaveTextContent("没有保存到系统");
    fireEvent.change(editor, { target: { value: "{" } });
    await user.click(screen.getByRole("button", { name: "应用到本页草稿" }));
    expect(screen.getByRole("alert")).toHaveTextContent("原草稿未变");
    await user.click(screen.getByRole("button", { name: "向导模式" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "返回" }));
    expect(editor).toHaveValue("{");
    await user.click(screen.getByRole("button", { name: "向导模式" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "丢弃未应用修改" }));
    expect(screen.getByRole("textbox", { name: "工具展示名称" })).toHaveValue("专业修改后的名称");
  });

  it("清空取消保留草稿和多行输入，确认只清自己草稿登记，卸载不清其他键", async () => {
    const user = userEvent.setup();
    const view = render(<WebToolDesignStudio targets={[]} />);
    await nameAndInputs(user);
    await user.click(screen.getByRole("button", { name: "添加输入项" }));
    await user.type(screen.getByRole("textbox", { name: "新输入项（必填）" }), "业务正文第一行\n业务正文第二行");
    const calls = vi.mocked(notifyDraftState).mock.calls;
    const key = calls[calls.length - 1][0].agentId;
    expect(key).toMatch(/^web-tool-design:/);
    expect(notifyDraftState).toHaveBeenLastCalledWith({ agentId: key, dirty: true });
    await user.click(screen.getByRole("button", { name: "清空草稿" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "返回" }));
    expect(screen.getByRole("textbox", { name: "新输入项（必填）" })).toHaveValue("业务正文第一行\n业务正文第二行");
    await user.click(screen.getByRole("button", { name: "清空草稿" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "清空本页草稿" }));
    expect(screen.getByRole("textbox", { name: "工具展示名称" })).toHaveValue("");
    expect(screen.queryByRole("textbox", { name: "新输入项（必填）" })).not.toBeInTheDocument();
    expect(notifyDraftState).toHaveBeenLastCalledWith({ agentId: key, dirty: false });
    view.unmount();
    expect(notifyDraftState).toHaveBeenLastCalledWith({ agentId: key, dirty: false });
  });

  it("预览输入校验反馈随字段变化失效，不能保留旧检查成功", async () => {
    const user = userEvent.setup();
    render(<WebToolDesignStudio targets={[]} />);
    await nameAndInputs(user);
    await user.click(screen.getByRole("button", { name: "添加输入项" }));
    await user.type(screen.getByRole("textbox", { name: "新输入项（必填）" }), "多行正文");
    await user.click(screen.getByRole("button", { name: "检查填写" }));
    expect(screen.getByRole("status")).toHaveTextContent("没有生成结果");
    await user.selectOptions(screen.getByRole("combobox", { name: "输入类型" }), "number");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "检查填写" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请核对必填项及输入类型");
  });

  it("本地项目键与对象原型同名不会读到继承值或把空填写当成功", async () => {
    const user = userEvent.setup();
    const draft = { ...createWebToolDesignDraft(), name: "预览", fields: [{ ...designFieldsFromTarget(target)[0], id: "toString" }] };
    render(<WebToolLayoutPreview draft={draft} values={{}} onValueChange={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: "业务正文（必填）" })).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "检查填写" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请核对必填项及输入类型");
  });

  it("无效输入项回到对应步骤聚焦名称，错误说明关联到该项", async () => {
    const user = userEvent.setup();
    render(<WebToolDesignStudio targets={[]} />);
    await nameAndInputs(user);
    await user.click(screen.getByRole("button", { name: "添加输入项" }));
    await user.clear(screen.getByRole("textbox", { name: "显示名称" }));
    await user.click(screen.getByRole("button", { name: "3. 结果呈现" }));
    expect(screen.getByRole("button", { name: "2. 输入项" })).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("textbox", { name: "显示名称" })).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "显示名称" })).toHaveAttribute("aria-describedby", screen.getByRole("alert").id);
  });

  it("无效上限预览使用中文占位，次数输入的最小值与草稿契约一致", async () => {
    const user = userEvent.setup();
    render(<WebToolDesignStudio targets={[]} />);
    await user.type(screen.getByRole("textbox", { name: "工具展示名称" }), "上限设计");
    await user.click(screen.getByRole("button", { name: "4. 访问与发布" }));
    expect(screen.getByRole("spinbutton", { name: "每小时次数上限" })).toHaveAttribute("min", "1");
    await user.clear(screen.getByRole("spinbutton", { name: "每小时次数上限" }));
    await user.click(screen.getByRole("tab", { name: "接入说明" }));
    expect(screen.getByText("待填写或检查 / 100")).toBeVisible();
    expect(screen.queryByText(/NaN|Infinity/)).not.toBeInTheDocument();
  });

  it("正式助手名称为内部编号时用中文显示，专业格式化超限保留填写", async () => {
    const user = userEvent.setup();
    render(<WebToolDesignStudio targets={[{ ...target, agentName: target.agentId }]} />);
    expect(screen.getByRole("option", { name: "正式助手 · 第 2 版" })).toBeInTheDocument();
    expect(screen.queryByText(target.agentId)).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "工具展示名称" }), "上限检查");
    await user.click(screen.getByRole("button", { name: "专业配置" }));
    const text = "x".repeat(100 * 1024 + 1);
    fireEvent.change(screen.getByRole("textbox", { name: "本页设计结构" }), { target: { value: text } });
    await user.click(screen.getByRole("button", { name: "格式化配置" }));
    expect(screen.getByRole("alert")).toHaveTextContent("专业配置不能超过 100 千字节");
    expect(screen.getByRole("textbox", { name: "本页设计结构" })).toHaveValue(text);
  });
});
