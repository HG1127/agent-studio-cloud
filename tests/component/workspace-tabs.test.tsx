import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceTabs, type WorkspaceTab } from "@/components/ui/WorkspaceTabs";
import { CapabilityNotice } from "@/components/ui/CapabilityNotice";

function LocalDraft() {
  const [text, setText] = useState("");
  return <label>本地填写<input value={text} onChange={(event) => setText(event.target.value)} /></label>;
}

function sections(): WorkspaceTab[] {
  return [{ id: "draft", label: "页面设计", description: "只检查本地草稿", content: <LocalDraft /> },
    { id: "records", label: "工具管理", content: <p>尚未读取工具记录</p> }];
}

describe("工作页面分区", () => {
  it("切换分区保留本地填写，隐藏分区不出现在可访问控件列表中", async () => {
    const user = userEvent.setup();
    render(<WorkspaceTabs label="网页工具功能" tabs={sections()} />);
    await user.type(screen.getByRole("textbox", { name: "本地填写" }), "未保存的页面标题");
    await user.click(screen.getByRole("tab", { name: "工具管理" }));
    expect(screen.queryByRole("textbox", { name: "本地填写" })).not.toBeInTheDocument();
    expect(screen.getByText("尚未读取工具记录")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "页面设计" }));
    expect(screen.getByRole("textbox", { name: "本地填写" })).toHaveValue("未保存的页面标题");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleName("页面设计");
    expect(screen.getByRole("tabpanel")).toHaveAccessibleDescription("只检查本地草稿");
  });

  it("左右方向键和首末快捷键切换分区并保持焦点", async () => {
    const user = userEvent.setup();
    render(<WorkspaceTabs label="网页工具功能" tabs={sections()} />);
    screen.getByRole("tab", { name: "页面设计" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "工具管理" })).toHaveFocus();
    expect(screen.getByRole("tab", { name: "工具管理" })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "页面设计" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: "工具管理" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: "页面设计" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: "工具管理" })).toHaveFocus();
  });

  it("受控分区只报告选择，由上层确认后改变显示", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    const view = render(<WorkspaceTabs label="网页工具功能" tabs={sections()} value="draft" onValueChange={change} />);
    await user.click(screen.getByRole("tab", { name: "工具管理" }));
    expect(change).toHaveBeenCalledExactlyOnceWith("records");
    expect(screen.getByRole("tab", { name: "页面设计" })).toHaveAttribute("aria-selected", "true");
    view.rerender(<WorkspaceTabs label="网页工具功能" tabs={sections()} value="records" onValueChange={change} />);
    expect(screen.getByRole("tab", { name: "工具管理" })).toHaveAttribute("aria-selected", "true");
  });

  it("草稿提示不声称系统已经保存或配置已生效", () => {
    render(<CapabilityNotice mode="draft" />);
    expect(screen.getByText("仅本页草稿，尚未保存")).toBeInTheDocument();
    expect(screen.getByText(/不会改变系统配置/)).toBeInTheDocument();
    expect(screen.queryByText("已接入现有接口")).not.toBeInTheDocument();
  });
});
