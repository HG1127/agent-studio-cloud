import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import NotFound from "@/app/not-found";

describe("全站未找到页面", () => {
  it("使用中文说明并提供返回入口", () => {
    render(<NotFound />);

    expect(screen.getByRole("heading", { name: "没有找到你要查看的内容" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回工作台" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "查看助手" })).toHaveAttribute("href", "/agents");
    expect(screen.getByRole("link", { name: "查看运行记录" })).toHaveAttribute("href", "/runs");
  });
});
