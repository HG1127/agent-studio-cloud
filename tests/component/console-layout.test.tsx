import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ConsoleLayout from "@/app/(console)/layout";

describe("全局导航", () => {
  it("提供助手、知识库与运行记录入口", () => {
    render(<ConsoleLayout><div>内容</div></ConsoleLayout>);
    expect(screen.getByRole("link", { name: "助手" })).toHaveAttribute("href", "/agents");
    expect(screen.getByRole("link", { name: "知识库" })).toHaveAttribute("href", "/knowledge");
    expect(screen.getByRole("link", { name: "运行记录" })).toHaveAttribute("href", "/runs");
  });
});
