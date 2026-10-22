import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ConsoleLayout from "@/app/(console)/layout";
import { DRAFT_STATE_EVENT } from "@/lib/draft-state";

afterEach(() => vi.restoreAllMocks());

describe("全局导航", () => {
  it("提供助手、知识库、定时任务与运行记录入口", () => {
    render(<ConsoleLayout><div>内容</div></ConsoleLayout>);
    expect(screen.getByRole("link", { name: "助手" })).toHaveAttribute("href", "/agents");
    expect(screen.getByRole("link", { name: "知识库" })).toHaveAttribute("href", "/knowledge");
    expect(screen.getByRole("link", { name: "模型连接" })).toHaveAttribute("href", "/settings");
    expect(screen.getByRole("link", { name: "定时任务" })).toHaveAttribute("href", "/schedules");
    expect(screen.getByRole("link", { name: "运行记录" })).toHaveAttribute("href", "/runs");
  });

  it("画布有未保存修改时阻止应用内导航", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ConsoleLayout><div>内容</div></ConsoleLayout>);
    act(() => window.dispatchEvent(new CustomEvent(DRAFT_STATE_EVENT, {
      detail: { agentId: "00000000-0000-4000-8000-000000000001", dirty: true },
    })));

    expect(fireEvent.click(screen.getByRole("link", { name: "知识库" }))).toBe(false);
    expect(confirm).toHaveBeenCalledWith("流程还有未保存修改，确定离开当前页面吗？");
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
