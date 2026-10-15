import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebToolDesignStudio } from "@/features/web-tools/WebToolDesignStudio";
import { createWebToolDesignDraft } from "@/features/web-tools/web-tool-design-draft";
import { notifyDraftState } from "@/lib/draft-state";

vi.mock("@/lib/draft-state", () => ({ notifyDraftState: vi.fn() }));
const network = vi.fn();
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", network); });
afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

function inputs() { return within(screen.getByRole("region", { name: "输入项配置" })); }
function commandInput() { return inputs().getByRole("textbox", { name: "用中文调整输入项" }); }
function applyButton() { return inputs().getByRole("button", { name: "确认应用到本页" }); }
async function openInputs(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole("textbox", { name: "工具展示名称" }), "业务网页工具");
  await user.click(screen.getByRole("button", { name: "2. 输入项" }));
}
async function addManual(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(inputs().getByRole("button", { name: "添加输入项" }));
  const groups = inputs().getAllByRole("group");
  const name = within(groups[groups.length - 1]).getByRole("textbox", { name: "显示名称" });
  await user.clear(name); await user.type(name, label);
}
async function instruct(user: ReturnType<typeof userEvent.setup>, value: string) {
  await user.clear(commandInput()); await user.type(commandInput(), value);
}

describe("网页工具中文快捷编辑的真实设计组件", () => {
  it("先展示变更，回车只定位确认按钮，再次明确确认才新增选填文本", async () => {
    const user = userEvent.setup(); render(<WebToolDesignStudio targets={[]} />); await openInputs(user);
    expect(applyButton()).toBeDisabled();
    await user.type(commandInput(), "加一个本周最大的收获");
    expect(inputs().getByText(/待应用的变更：新增选填的文本输入项「本周最大的收获」/)).toBeVisible();
    expect(inputs().queryByRole("group", { name: "输入项 1" })).not.toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(applyButton()).toHaveFocus();
    expect(inputs().queryByRole("group", { name: "输入项 1" })).not.toBeInTheDocument();
    await user.keyboard("{Enter}");
    const added = within(inputs().getByRole("group", { name: "输入项 1" }));
    expect(added.getByRole("textbox", { name: "显示名称" })).toHaveValue("本周最大的收获");
    expect(added.getByRole("combobox", { name: "输入类型" })).toHaveValue("string");
    expect(added.getByRole("checkbox", { name: "设为必填" })).not.toBeChecked();
    expect(commandInput()).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("尚未保存或发布");
    await user.click(screen.getByRole("button", { name: "专业配置" }));
    const design = JSON.parse((screen.getByRole("textbox", { name: "本页设计结构" }) as HTMLTextAreaElement).value);
    expect(design.fields).toEqual([expect.objectContaining({ label: "本周最大的收获", name: expect.stringMatching(/^input_/), type: "string", required: false })]);
  });

  it("设为选填和必填只改指定项，原提示与说明保持，重复相同要求不再应用", async () => {
    const user = userEvent.setup(); render(<WebToolDesignStudio targets={[]} />); await openInputs(user); await addManual(user, "下周计划");
    const target = within(inputs().getByRole("group", { name: "输入项 1" }));
    await user.type(target.getByRole("textbox", { name: "填写提示" }), "请按事项填写");
    await user.type(target.getByRole("textbox", { name: "补充说明" }), "保留原说明");
    await instruct(user, "把下周计划设为选填"); await user.click(applyButton());
    expect(target.getByRole("checkbox", { name: "设为必填" })).not.toBeChecked();
    await instruct(user, "把下周计划设为必填"); await user.click(applyButton());
    expect(target.getByRole("checkbox", { name: "设为必填" })).toBeChecked();
    expect(target.getByRole("textbox", { name: "填写提示" })).toHaveValue("请按事项填写");
    expect(target.getByRole("textbox", { name: "补充说明" })).toHaveValue("保留原说明");
    await instruct(user, "把下周计划设为必填");
    expect(inputs().getByText(/已经是必填，无需重复调整/)).toBeVisible();
    expect(applyButton()).toBeDisabled();
  });

  it("重名时必须选择一个目标，不能默认首项或同时修改", async () => {
    const user = userEvent.setup(); render(<WebToolDesignStudio targets={[]} />); await openInputs(user);
    await addManual(user, "事项"); await addManual(user, "事项");
    await instruct(user, "把事项设为选填");
    expect(applyButton()).toBeDisabled();
    expect(inputs().getByText("这条指令可对应多个输入项，请明确选择其中一个。")).toBeVisible();
    await user.selectOptions(inputs().getByRole("combobox", { name: "选择要调整的输入项" }), inputs().getByRole("option", { name: "输入项 2 · 事项" }));
    await user.click(applyButton());
    expect(within(inputs().getByRole("group", { name: "输入项 1" })).getByRole("checkbox")).toBeChecked();
    expect(within(inputs().getByRole("group", { name: "输入项 2" })).getByRole("checkbox")).not.toBeChecked();
  });

  it("删除先用既有确认弹窗，返回保留指令和输入项，确认后才移除", async () => {
    const user = userEvent.setup(); render(<WebToolDesignStudio targets={[]} />); await openInputs(user); await addManual(user, "下周计划");
    await instruct(user, "删除下周计划"); await user.click(applyButton());
    expect(screen.getByRole("dialog")).toHaveTextContent("不会修改已发布工具");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "返回" }));
    expect(commandInput()).toHaveValue("删除下周计划");
    expect(inputs().getByRole("group", { name: "输入项 1" })).toBeInTheDocument();
    await user.click(applyButton());
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "移除" }));
    expect(inputs().queryByRole("group", { name: "输入项 1" })).not.toBeInTheDocument();
    expect(commandInput()).toHaveValue("");
    expect(inputs().getByRole("button", { name: "添加输入项" })).toHaveFocus();
  });

  it("无法识别、部分名称和重复新增均有明确原因，不兜底添加或覆盖", async () => {
    const user = userEvent.setup(); render(<WebToolDesignStudio targets={[]} />); await openInputs(user); await addManual(user, "下周计划");
    for (const [instruction, message] of [["帮我优化表单", "暂不支持这条指令"], ["删除计划", "没有找到完全同名"], ["添加下周计划", "已有同名输入项"]]) {
      await instruct(user, instruction);
      expect(inputs().getByText(new RegExp(message))).toBeVisible();
      expect(applyButton()).toBeDisabled();
      expect(inputs().getAllByRole("group")).toHaveLength(1);
      expect(within(inputs().getByRole("group", { name: "输入项 1" })).getByRole("textbox", { name: "显示名称" })).toHaveValue("下周计划");
    }
  });

  it("中文输入法确认不会误应用或抢走输入焦点", async () => {
    const user = userEvent.setup(); render(<WebToolDesignStudio targets={[]} />); await openInputs(user);
    await user.type(commandInput(), "添加备注");
    fireEvent.keyDown(commandInput(), { key: "Enter", isComposing: true });
    expect(commandInput()).toHaveFocus();
    expect(inputs().queryByRole("group")).not.toBeInTheDocument();
    expect(commandInput()).toHaveValue("添加备注");
  });

  it("清空设计取消保留指令，确认后同时清除指令、预览与自身草稿登记", async () => {
    const user = userEvent.setup(); render(<WebToolDesignStudio targets={[]} />); await openInputs(user);
    await user.type(commandInput(), "添加本周收获");
    await user.click(screen.getByRole("button", { name: "清空草稿" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "返回" }));
    expect(commandInput()).toHaveValue("添加本周收获");
    await user.click(screen.getByRole("button", { name: "清空草稿" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "清空本页草稿" }));
    expect(notifyDraftState).toHaveBeenLastCalledWith({ agentId: expect.stringMatching(/^web-tool-design:/), dirty: false });
    await openInputs(user);
    expect(commandInput()).toHaveValue("");
    expect(inputs().queryByRole("group")).not.toBeInTheDocument();
  });

  it("满一百项的专业配置仍可核对，但快捷新增被限制且不覆盖配置", async () => {
    const user = userEvent.setup(); render(<WebToolDesignStudio targets={[]} />);
    await user.click(screen.getByRole("button", { name: "专业配置" }));
    const design = { ...createWebToolDesignDraft(), name: "容量检查", fields: Array.from({ length: 100 }, (_, index) => ({
      id: "input-" + index, name: "input_" + index, label: "项目" + index, type: "string", required: false, rows: 1, placeholder: "", description: "",
    })) };
    fireEvent.change(screen.getByRole("textbox", { name: "本页设计结构" }), { target: { value: JSON.stringify(design) } });
    await user.click(screen.getByRole("button", { name: "应用到本页草稿" }));
    await user.click(screen.getByRole("button", { name: "向导模式" }));
    await user.click(screen.getByRole("button", { name: "2. 输入项" }));
    await instruct(user, "添加新项目");
    expect(inputs().getByText(/最多可设计 100 个输入项/)).toBeVisible();
    expect(applyButton()).toBeDisabled();
    expect(inputs().getAllByRole("group")).toHaveLength(100);
  });
});
