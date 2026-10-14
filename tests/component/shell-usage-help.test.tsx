import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConsoleLayout from "@/app/(console)/layout";
import { ReadOnlyDialog } from "@/components/ui/ReadOnlyDialog";
import { DRAFT_STATE_EVENT } from "@/lib/draft-state";

const pathnameState = vi.hoisted(() => ({ current: "/agents/new" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathnameState.current }));

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("status unavailable")));
});
afterEach(() => {
  cleanup();
  pathnameState.current = "/agents/new";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderPage() {
  const result = render(<ConsoleLayout><label>本地填写<input defaultValue="尚未保存的工作目标" /></label><button type="button">打开使用帮助更多</button></ConsoleLayout>);
  await screen.findByRole("link", { name: /云端运行服务：状态未知/ });
  return result;
}

describe("全局使用帮助的实际父层", () => {
  it("打开真正的帮助窗口，不导航、不读取业务或改掉本地填写", async () => {
    await renderPage();
    const user = userEvent.setup();
    const fetch = vi.mocked(globalThis.fetch);
    const before = fetch.mock.calls.length;
    expect(screen.queryByRole("link", { name: "查看帮助与操作记录" })).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "打开使用帮助" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "使用帮助" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(within(dialog).getByRole("region", { name: "日常使用步骤" })).toHaveTextContent("创建记录不等于完成");
    expect(dialog).toHaveTextContent("不会保存设置、启动或取消任务");
    expect(dialog).not.toHaveTextContent("已准备");
    expect(fetch).toHaveBeenCalledTimes(before);
    expect(screen.getByLabelText("本地填写")).toHaveValue("尚未保存的工作目标");
  });

  it("帮助入口全部连接既有真实路由，名称严格匹配且保留独立说明", async () => {
    await renderPage();
    await userEvent.setup().click(screen.getByRole("button", { name: "打开使用帮助" }));
    const dialog = screen.getByRole("dialog", { name: "使用帮助" });
    const destinations = [
      ["找到需要使用的助手", "/agents"], ["创建与完善助手", "/agents/new"],
      ["准备公司资料", "/knowledge"], ["配置模型连接", "/settings"],
      ["查看结果与反馈", "/runs"], ["检查运行服务", "/#system-health"],
      ["核对外部工具", "/connections"], ["查看待处理任务", "/runs/attention"],
    ];
    for (const [name, href] of destinations) expect(within(dialog).getByRole("link", { name })).toHaveAttribute("href", href);
    expect(within(dialog).getByRole("link", { name: "配置模型连接" })).toHaveAccessibleDescription(/不代表整条流程或业务验收通过/);
    expect(within(dialog).getByRole("link", { name: "检查运行服务" })).toHaveAccessibleDescription(/前往工作台查看/);
    await userEvent.setup().click(within(dialog).getByRole("button", { name: "关闭使用帮助" }));
    expect(screen.getByRole("navigation", { name: "主导航" }).querySelector('a[href="/activity"]')).not.toBeNull();
  });

  it.each(["button", "escape"])("通过%s关闭并恢复触发按钮焦点，不清除原填写", async (mode) => {
    await renderPage();
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "打开使用帮助" });
    await user.click(trigger);
    if (mode === "escape") await user.keyboard("{Escape}");
    else await user.click(screen.getByRole("button", { name: "关闭使用帮助" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "使用帮助" })).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("本地填写")).toHaveValue("尚未保存的工作目标");
  });

  it("打开帮助不触发离页确认，帮助中的普通链接仍经过真实草稿保护", async () => {
    await renderPage();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    act(() => window.dispatchEvent(new CustomEvent(DRAFT_STATE_EVENT, { detail: { agentId: "00000000-0000-4000-8000-000000000001", dirty: true } })));
    await userEvent.setup().click(screen.getByRole("button", { name: "打开使用帮助" }));
    expect(confirm).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "使用帮助" });
    expect(fireEvent.click(within(dialog).getByRole("link", { name: "准备公司资料" }))).toBe(false);
    expect(confirm).toHaveBeenCalledWith("页面还有未保存修改，确定离开当前页面吗？");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText("本地填写")).toHaveValue("尚未保存的工作目标");
  });

  it("真实地址范围变化后关闭旧帮助窗口，不转移到下一页", async () => {
    const { rerender } = await renderPage();
    await userEvent.setup().click(screen.getByRole("button", { name: "打开使用帮助" }));
    pathnameState.current = "/runs";
    rerender(<ConsoleLayout><div>新的页面内容</div></ConsoleLayout>);
    expect(screen.queryByRole("dialog", { name: "使用帮助" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开使用帮助" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("navigation", { name: "当前位置" })).toHaveTextContent("处理记录");
  });

  it("证据窗口的原默认关闭名称保持不变", () => {
    render(<ReadOnlyDialog open onOpenChange={() => undefined} title="原证据" description="原说明"><p>原内容</p></ReadOnlyDialog>);
    expect(screen.getByRole("button", { name: "关闭证据窗口" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "关闭使用帮助" })).not.toBeInTheDocument();
  });
});
