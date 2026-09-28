import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ToolCatalog } from "@/features/capabilities/ToolCatalog";
import type { ToolRegistryOption } from "@/contracts/tool-registry";

const tools: ToolRegistryOption[] = [
  { id: "crm.lookup", name: "查找客户", description: "按名称查询客户资料", action: "read", scope: "crm", risk: "low", inputSchema: {}, outputSchema: {} },
  { id: "finance.issue", name: "开具发票", description: "向财务系统提交开票申请", action: "write", scope: "finance", risk: "high", inputSchema: {}, outputSchema: {} },
  { id: "mail.send", name: "发送邮件", description: "", action: "write", scope: "mail", risk: "medium", inputSchema: {}, outputSchema: {} },
];

describe("业务工具目录", () => {
  it("只展示真实注册清单与风险，不把登记当成连接就绪", () => {
    render(<ToolCatalog tools={tools} />);
    expect(screen.getByRole("heading", { name: "业务工具目录" })).toBeInTheDocument();
    expect(screen.getByText("已登记 3 项")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "查找客户" })).toBeInTheDocument();
    expect(screen.getAllByText("高风险")).toHaveLength(2);
    expect(screen.getAllByText("已登记 · 连接状态未在此处验证")).toHaveLength(3);
    expect(screen.getByText("管理员尚未填写用途说明；使用前请在流程中核对输入和结果。")).toBeInTheDocument();
    expect(screen.queryByText("crm.lookup")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "前往助手流程设计" })).toHaveAttribute("href", "/agents");
  });

  it("按名称、用途及真实风险级别筛选，不构造健康状态", async () => {
    const user = userEvent.setup();
    render(<ToolCatalog tools={tools} />);
    await user.type(screen.getByRole("searchbox", { name: "搜索业务工具" }), "客户");
    expect(screen.getByRole("heading", { name: "查找客户" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "开具发票" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("当前显示 1 / 3 项");
    await user.clear(screen.getByRole("searchbox", { name: "搜索业务工具" }));
    await user.click(screen.getByRole("button", { name: "高风险" }));
    expect(screen.getByRole("button", { name: "高风险" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "开具发票" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "查找客户" })).not.toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: "搜索业务工具" }), "没有这个工具");
    expect(screen.getByText("没有符合条件的工具。请调整关键词或风险筛选。")).toBeInTheDocument();
  });

  it("空注册表明确说明演示工具不连接公司系统", () => {
    render(<ToolCatalog tools={[]} />);
    expect(screen.getByText("当前没有已登记的业务工具")).toBeInTheDocument();
    expect(screen.getByText(/演示工具只用于检查流程结构，不连接公司系统/)).toBeInTheDocument();
    expect(screen.queryByRole("searchbox", { name: "搜索业务工具" })).not.toBeInTheDocument();
  });
});
