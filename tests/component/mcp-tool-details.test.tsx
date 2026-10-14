import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ToolCatalog } from "@/features/capabilities/ToolCatalog";
import { ExternalConnectionBoundary } from "@/features/connections/ExternalConnectionBoundary";

const tools = [
  { id: "private.crm", name: "查询客户", description: "查询客户资料", risk: "low" as const },
  { id: "private.finance", name: "提交开票", description: "", risk: "high" as const },
];

describe("外部工具详情与连接边界", () => {
  it("可展开真实工具用途与风险，明确未验证事项且不暴露内部标识", async () => {
    const user = userEvent.setup();
    const { container } = render(<ToolCatalog tools={tools} />);
    const summary = screen.getByText("查看提交开票的详情");
    await user.click(summary);
    expect(summary.closest("details")).toHaveAttribute("open");
    expect(screen.getByText("管理员尚未提供用途说明，请联系管理员确认。")).toBeVisible();
    expect(screen.getByText(/此项被登记为高风险工具/)).toBeVisible();
    expect(screen.getAllByText(/目录未提供连接检查、授权结果或最近运行回执/)[1]).toBeVisible();
    expect(container.textContent).not.toMatch(/private\.crm|private\.finance/);
    await user.click(summary);
    expect(summary.closest("details")).not.toHaveAttribute("open");
  });

  it("清除无结果的组合筛选后恢复服务端提供的整个清单", async () => {
    const user = userEvent.setup();
    render(<ToolCatalog tools={tools} />);
    await user.click(screen.getByRole("button", { name: "高风险" }));
    await user.type(screen.getByRole("searchbox"), "客户");
    expect(screen.getByRole("status")).toHaveTextContent("当前显示 0 / 2 项");
    await user.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByRole("button", { name: "全部风险" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("status")).toHaveTextContent("当前显示 2 / 2 项");
  });

  it("没有连接后端时不收集凭据或提供假动作", () => {
    render(<ExternalConnectionBoundary registeredCount={2} />);
    expect(screen.getByText(/可检查管理员登记的连接/)).toBeInTheDocument();
    expect(screen.getByText(/检查会读取远端目录/)).toBeInTheDocument();
    expect(screen.getByText(/检查通过不代表获得业务授权或调用成功/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
