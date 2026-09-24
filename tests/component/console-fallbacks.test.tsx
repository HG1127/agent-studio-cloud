import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ConsoleError from "@/app/(console)/error";
import ConsoleLoading from "@/app/(console)/loading";
import NotFound from "@/app/not-found";

describe("页面故障恢复", () => {
  it("服务端读取失败时提供重试和返回工作台入口", async () => {
    const reset = vi.fn();
    render(<ConsoleError error={new Error("database unavailable")} reset={reset} />);
    expect(screen.getByRole("alert")).toHaveTextContent("页面暂时无法打开");
    await userEvent.click(screen.getByRole("button", { name: "重新加载" }));
    expect(reset).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "返回工作台" })).toHaveAttribute("href", "/");
  });

  it("页面加载和找不到内容时显示中文反馈", () => {
    const { rerender } = render(<ConsoleLoading />);
    expect(screen.getByText("正在读取最新数据…")).toBeInTheDocument();
    rerender(<NotFound />);
    expect(screen.getByRole("heading", { name: "没有找到这个页面" })).toBeInTheDocument();
  });
});
