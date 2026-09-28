import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConsoleLayout from "@/app/(console)/layout";
import { DRAFT_STATE_EVENT } from "@/lib/draft-state";

const pathnameState = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathnameState.current }));

afterEach(() => {
  pathnameState.current = "/";
  vi.restoreAllMocks();
});

describe("全局导航", () => {
  it("提供助手、知识库、定时任务与运行记录入口", () => {
    render(<ConsoleLayout><div>内容</div></ConsoleLayout>);
    expect(screen.getByRole("link", { name: "助手" })).toHaveAttribute("href", "/agents");
    expect(screen.getByRole("link", { name: "知识库" })).toHaveAttribute("href", "/knowledge");
    expect(screen.getByRole("link", { name: "模型连接" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("link", { name: "定时任务" })).toHaveAttribute("href", "/schedules");
    expect(screen.getByRole("link", { name: "运行记录" })).toHaveAttribute("href", "/runs");
    expect(screen.getByRole("link", { name: "网页工具" })).toHaveAttribute("href", "/web-tools");
    expect(screen.getByRole("link", { name: "外部工具连接" })).toHaveAttribute("href", "/connections");
  });

  it("程序化跳转后同步更新侧栏选中状态与顶部位置提示", () => {
    const { rerender } = render(<ConsoleLayout><div>内容</div></ConsoleLayout>);
    expect(screen.getByRole("link", { name: "总览" })).toHaveAttribute("aria-current", "page");

    pathnameState.current = "/runs/00000000-0000-4000-8000-000000000001";
    rerender(<ConsoleLayout><div>运行内容</div></ConsoleLayout>);
    expect(screen.getByRole("link", { name: "运行记录" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("navigation", { name: "当前位置" })).toHaveTextContent("运行详情");
    expect(screen.getByRole("link", { name: "总览" })).not.toHaveAttribute("aria-current");

    pathnameState.current = "/agents/new";
    rerender(<ConsoleLayout><div>创建内容</div></ConsoleLayout>);
    expect(screen.getByRole("link", { name: "助手" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("navigation", { name: "当前位置" })).toHaveTextContent("创建助手");
  });

  it("画布有未保存修改时阻止应用内导航", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ConsoleLayout><div>内容</div></ConsoleLayout>);
    act(() => window.dispatchEvent(new CustomEvent(DRAFT_STATE_EVENT, {
      detail: { agentId: "00000000-0000-4000-8000-000000000001", dirty: true },
    })));

    expect(fireEvent.click(screen.getByRole("link", { name: "知识库" }))).toBe(false);
    expect(confirm).toHaveBeenCalledWith("页面还有未保存修改，确定离开当前页面吗？");
  });

  it("草稿已保存或使用组合键打开链接时不拦截", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ConsoleLayout><div>内容</div></ConsoleLayout>);
    const agentsLink = screen.getByRole("link", { name: "助手" });
    const knowledgeLink = screen.getByRole("link", { name: "知识库" });
    agentsLink.addEventListener("click", (event) => event.preventDefault());
    knowledgeLink.addEventListener("click", (event) => event.preventDefault());
    act(() => window.dispatchEvent(new CustomEvent(DRAFT_STATE_EVENT, {
      detail: { agentId: "00000000-0000-4000-8000-000000000001", dirty: true },
    })));

    fireEvent.click(agentsLink, { ctrlKey: true });
    expect(confirm).not.toHaveBeenCalled();
    act(() => window.dispatchEvent(new CustomEvent(DRAFT_STATE_EVENT, {
      detail: { agentId: "00000000-0000-4000-8000-000000000001", dirty: false },
    })));
    fireEvent.click(knowledgeLink);
    expect(confirm).not.toHaveBeenCalled();
  });
});
