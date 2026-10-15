import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceTabs } from "@/components/ui/WorkspaceTabs";
import { WebToolDesignStudio } from "@/features/web-tools/WebToolDesignStudio";

const network = vi.fn();
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", network); });
afterEach(() => {
  cleanup();
  expect(blocksRefresh()).toBe(false);
  expect(network).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

function blocksRefresh() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("网页工具页面设计的刷新保护", () => {
  it("空白设计和未改动的专业配置不拦截，恢复原配置后解除保护", async () => {
    const user = userEvent.setup();
    render(<WebToolDesignStudio targets={[]} />);
    expect(blocksRefresh()).toBe(false);
    await user.click(screen.getByRole("button", { name: "专业配置" }));
    const editor = screen.getByRole("textbox", { name: "本页设计结构" }) as HTMLTextAreaElement;
    const original = editor.value;
    expect(blocksRefresh()).toBe(false);
    fireEvent.change(editor, { target: { value: "{" } });
    expect(blocksRefresh()).toBe(true);
    fireEvent.change(editor, { target: { value: original } });
    expect(blocksRefresh()).toBe(false);
    await user.click(screen.getByRole("button", { name: "向导模式" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(blocksRefresh()).toBe(false);
  });

  it("向导编辑后保护填写，取消清空保持，明确清空才解除", async () => {
    const user = userEvent.setup();
    render(<WebToolDesignStudio targets={[]} />);
    const name = screen.getByRole("textbox", { name: "工具展示名称" });
    fireEvent.change(name, { target: { value: "未保存的工具" } });
    expect(blocksRefresh()).toBe(true);
    expect(name).toHaveValue("未保存的工具");
    await user.click(screen.getByRole("button", { name: "清空草稿" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "返回" }));
    expect(name).toHaveValue("未保存的工具");
    expect(blocksRefresh()).toBe(true);
    await user.click(screen.getByRole("button", { name: "清空草稿" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "清空本页草稿" }));
    expect(name).toHaveValue("");
    expect(blocksRefresh()).toBe(false);
  });

  it("只有无效的未应用配置也保护，失败和取消返回不清除填写", async () => {
    const user = userEvent.setup();
    render(<WebToolDesignStudio targets={[]} />);
    await user.click(screen.getByRole("button", { name: "专业配置" }));
    const editor = screen.getByRole("textbox", { name: "本页设计结构" });
    fireEvent.change(editor, { target: { value: "{" } });
    await user.click(screen.getByRole("button", { name: "应用到本页草稿" }));
    expect(screen.getByRole("alert")).toBeVisible();
    expect(blocksRefresh()).toBe(true);
    await user.click(screen.getByRole("button", { name: "向导模式" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "返回" }));
    expect(editor).toHaveValue("{");
    expect(blocksRefresh()).toBe(true);
    await user.click(screen.getByRole("button", { name: "向导模式" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "丢弃未应用修改" }));
    expect(screen.getByRole("textbox", { name: "工具展示名称" })).toHaveValue("");
    expect(blocksRefresh()).toBe(false);
  });

  it("中文指令未应用时保留内容，取消清空不误应用，确认清空才解除保护", async () => {
    const user = userEvent.setup();
    render(<WebToolDesignStudio targets={[]} />);
    fireEvent.change(screen.getByRole("textbox", { name: "工具展示名称" }), { target: { value: "业务工具" } });
    await user.click(screen.getByRole("button", { name: "2. 输入项" }));
    const command = screen.getByRole("textbox", { name: "用中文调整输入项" });
    fireEvent.change(command, { target: { value: "添加备注" } });
    expect(blocksRefresh()).toBe(true);
    await user.click(screen.getByRole("button", { name: "清空草稿" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "返回" }));
    expect(command).toHaveValue("添加备注");
    expect(screen.queryByRole("group", { name: /^输入项 \d+$/ })).not.toBeInTheDocument();
    expect(blocksRefresh()).toBe(true);
    await user.click(screen.getByRole("button", { name: "清空草稿" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "清空本页草稿" }));
    expect(blocksRefresh()).toBe(false);
  });

  it("切到其他分区仍保护隐藏的设计，切回保留填写，卸载解除", async () => {
    const user = userEvent.setup();
    const view = render(<WorkspaceTabs label="工具分区" tabs={[
      { id: "design", label: "页面设计", content: <WebToolDesignStudio targets={[]} /> },
      { id: "manage", label: "工具管理", content: <p>工具管理分区</p> },
    ]} />);
    fireEvent.change(screen.getByRole("textbox", { name: "工具展示名称" }), { target: { value: "保留设计" } });
    await user.click(screen.getByRole("tab", { name: "工具管理" }));
    expect(screen.queryByRole("textbox", { name: "工具展示名称" })).not.toBeInTheDocument();
    expect(blocksRefresh()).toBe(true);
    await user.click(screen.getByRole("tab", { name: "页面设计" }));
    expect(screen.getByRole("textbox", { name: "工具展示名称" })).toHaveValue("保留设计");
    view.unmount();
    expect(blocksRefresh()).toBe(false);
  });

  it("两个独立设计分别清理监听，卸载一份不解除另一份保护", () => {
    const first = render(<WebToolDesignStudio targets={[]} />);
    const second = render(<WebToolDesignStudio targets={[]} />);
    fireEvent.change(within(first.container).getByRole("textbox", { name: "工具展示名称" }), { target: { value: "第一份" } });
    fireEvent.change(within(second.container).getByRole("textbox", { name: "工具展示名称" }), { target: { value: "第二份" } });
    expect(blocksRefresh()).toBe(true);
    first.unmount();
    expect(blocksRefresh()).toBe(true);
    expect(within(second.container).getByRole("textbox", { name: "工具展示名称" })).toHaveValue("第二份");
    second.unmount();
    expect(blocksRefresh()).toBe(false);
  });

  it("严格模式重复挂载后可保护，卸载不残留监听", () => {
    const view = render(<StrictMode><WebToolDesignStudio targets={[]} /></StrictMode>);
    expect(blocksRefresh()).toBe(false);
    fireEvent.change(screen.getByRole("textbox", { name: "工具展示名称" }), { target: { value: "严格模式草稿" } });
    expect(blocksRefresh()).toBe(true);
    view.unmount();
    expect(blocksRefresh()).toBe(false);
  });

  it("丢弃专业配置不能解除已有向导草稿的保护，检查草稿也不代表保存", async () => {
    const user = userEvent.setup();
    render(<WebToolDesignStudio targets={[]} />);
    fireEvent.change(screen.getByRole("textbox", { name: "工具展示名称" }), { target: { value: "保留向导草稿" } });
    await user.click(screen.getByRole("button", { name: "专业配置" }));
    fireEvent.change(screen.getByRole("textbox", { name: "本页设计结构" }), { target: { value: "{" } });
    await user.click(screen.getByRole("button", { name: "向导模式" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "丢弃未应用修改" }));
    expect(screen.getByRole("textbox", { name: "工具展示名称" })).toHaveValue("保留向导草稿");
    expect(blocksRefresh()).toBe(true);
    await user.click(screen.getByRole("button", { name: "检查草稿" }));
    expect(blocksRefresh()).toBe(true);
    expect(screen.getByRole("button", { name: "保存页面配置（待接入）" })).toBeDisabled();
  });
});
