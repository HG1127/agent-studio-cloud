import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ConsoleLayout from "@/app/(console)/layout";
import { DRAFT_STATE_EVENT } from "@/lib/draft-state";

const state = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
beforeEach(() => { state.pathname = "/"; vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: false, db: false, workflow: true }))); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function navigation() { return within(screen.getByRole("navigation", { name: "主导航" })); }

describe("真实桌面全站导航", () => {
  it("首次只展示五个一级入口，按需展开低频真实页面而不跳转", async () => {
    const user = userEvent.setup(); render(<ConsoleLayout><p>真实页面内容</p></ConsoleLayout>);
    const nav = navigation();
    expect(nav.getByRole("link", { name: "工作台" })).toHaveAttribute("aria-current", "page");
    expect(nav.getByRole("link", { name: "我的助手" })).toHaveAttribute("href", "/agents");
    expect(nav.getByRole("link", { name: "处理记录" })).toHaveAttribute("href", "/runs");
    expect(nav.getByRole("button", { name: "资料与应用" })).toHaveAttribute("aria-expanded", "false");
    expect(nav.getByRole("button", { name: "管理设置" })).toHaveAttribute("aria-expanded", "false");
    expect(nav.queryByRole("link", { name: "验收中心" })).not.toBeInTheDocument();
    expect(nav.queryByRole("link", { name: "模型连接" })).not.toBeInTheDocument();
    await user.click(nav.getByRole("button", { name: "管理设置" }));
    expect(nav.getByRole("link", { name: "运行控制台" })).toHaveAttribute("href", "/harness");
    expect(nav.getByRole("link", { name: "网页工具" })).toHaveAttribute("href", "/web-tools");
    expect(nav.getByRole("link", { name: "共享经验" })).toHaveAttribute("href", "/memory");
    await user.click(nav.getByRole("button", { name: "管理设置" }));
    expect(nav.queryByRole("link", { name: "运行控制台" })).not.toBeInTheDocument();
    expect(nav.getByRole("link", { name: "工作台" })).toHaveAttribute("aria-current", "page");
  });
  it("直接进入低频页面即展开所在分区，当前位置与入口名称一致", () => {
    state.pathname = "/settings"; render(<ConsoleLayout><p>模型设置内容</p></ConsoleLayout>);
    expect(navigation().getByRole("button", { name: "资料与应用" })).toHaveAttribute("aria-expanded", "true");
    expect(navigation().getByRole("link", { name: "模型连接" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("navigation", { name: "当前位置" })).toHaveTextContent("工作台资料与应用模型连接");
    expect(navigation().getByRole("button", { name: "管理设置" })).toHaveAttribute("aria-expanded", "false");
  });
  it("手动收起后程序化换页会展示新页面入口，只标记一个当前链接", async () => {
    const user = userEvent.setup(); state.pathname = "/harness";
    const view = render(<ConsoleLayout><p>诊断内容</p></ConsoleLayout>);
    await user.click(navigation().getByRole("button", { name: "管理设置" }));
    expect(navigation().queryByRole("link", { name: "运行控制台" })).not.toBeInTheDocument();
    state.pathname = "/connections"; view.rerender(<ConsoleLayout><p>连接内容</p></ConsoleLayout>);
    expect(navigation().getByRole("link", { name: "外部工具连接" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("navigation", { name: "主导航" }).querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
    state.pathname = "/web-tools"; view.rerender(<ConsoleLayout><p>网页工具内容</p></ConsoleLayout>);
    expect(navigation().getByRole("link", { name: "网页工具" })).toHaveAttribute("aria-current", "page");
    expect(navigation().getByRole("button", { name: "管理设置" })).toHaveAttribute("aria-expanded", "true");
    state.pathname = "/harness"; view.rerender(<ConsoleLayout><p>重新返回诊断</p></ConsoleLayout>);
    expect(navigation().getByRole("link", { name: "运行控制台" })).toHaveAttribute("aria-current", "page");
  });
  it("待处理、工具核对和自动计划保持处理记录归属，子入口不是父页", () => {
    state.pathname = "/runs/attention"; const view = render(<ConsoleLayout><p>待办内容</p></ConsoleLayout>);
    expect(navigation().getByRole("link", { name: "待处理任务" })).toHaveAttribute("aria-current", "page");
    expect(navigation().getByRole("link", { name: "处理记录" })).not.toHaveAttribute("aria-current");
    state.pathname = "/tool-operations"; view.rerender(<ConsoleLayout><p>核对内容</p></ConsoleLayout>);
    expect(navigation().getByRole("link", { name: "工具结果核对" })).toHaveAttribute("aria-current", "page");
    state.pathname = "/schedules"; view.rerender(<ConsoleLayout><p>计划内容</p></ConsoleLayout>);
    expect(navigation().getByRole("link", { name: "定时任务" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("navigation", { name: "当前位置" })).toHaveTextContent("处理记录定时任务");
  });
  it("冻结版本提供原助手返回链接，但不展示内部编号", () => {
    state.pathname = "/agents/private-agent/versions/private-version";
    render(<ConsoleLayout><p>冻结内容</p></ConsoleLayout>);
    const crumbs = within(screen.getByRole("navigation", { name: "当前位置" }));
    expect(crumbs.getByRole("link", { name: "助手工作台" })).toHaveAttribute("href", "/agents/private-agent");
    expect(crumbs.getByText("冻结版本核对")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("navigation", { name: "当前位置" }).textContent).not.toMatch(/private-agent|private-version/);
  });
  it("展开子入口和跳到内容不离开草稿，真实页面链接仍有离页确认", async () => {
    const user = userEvent.setup(); const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ConsoleLayout><p>需要保留的草稿</p></ConsoleLayout>);
    act(() => window.dispatchEvent(new CustomEvent(DRAFT_STATE_EVENT, { detail: { agentId: "navigation-draft", dirty: true } })));
    await user.click(navigation().getByRole("button", { name: "资料与应用" }));
    expect(confirm).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "跳到页面内容" }));
    expect(screen.getByText("需要保留的草稿").parentElement).toHaveFocus();
    expect(confirm).not.toHaveBeenCalled();
    expect(fireEvent.click(navigation().getByRole("link", { name: "知识库" }))).toBe(false);
    expect(confirm).toHaveBeenCalledWith("页面还有未保存修改，确定离开当前页面吗？");
    act(() => window.dispatchEvent(new CustomEvent(DRAFT_STATE_EVENT, { detail: { agentId: "navigation-draft", dirty: false } })));
  });
  it("分区控制使用真实可访问关系，不伪造成员身份或待办数", async () => {
    const user = userEvent.setup(); render(<ConsoleLayout><p>页面内容</p></ConsoleLayout>);
    const button = navigation().getByRole("button", { name: "资料与应用" });
    const id = button.getAttribute("aria-controls");
    expect(id).toBeTruthy(); expect(document.getElementById(id ?? "")).toHaveAttribute("hidden");
    await user.click(button); expect(document.getElementById(id ?? "")).not.toHaveAttribute("hidden");
    expect(screen.getByText("身份与成员信息尚未接入")).toBeInTheDocument();
    expect(screen.queryByText("工作区成员")).not.toBeInTheDocument();
    expect(screen.queryByText("公司管理员")).not.toBeInTheDocument();
    expect(navigation().getByRole("link", { name: "我的助手" })).not.toHaveTextContent(/\d/);
  });
  it("键盘可以展开与收起分区，焦点保持在当前控制按钮", async () => {
    const user = userEvent.setup(); render(<ConsoleLayout><p>页面内容</p></ConsoleLayout>);
    const button = navigation().getByRole("button", { name: "资料与应用" });
    button.focus(); await user.keyboard("{Enter}");
    expect(button).toHaveAttribute("aria-expanded", "true"); expect(button).toHaveFocus();
    expect(navigation().getByRole("link", { name: "知识库" })).toBeVisible();
    await user.keyboard(" "); expect(button).toHaveAttribute("aria-expanded", "false"); expect(button).toHaveFocus();
  });
});
