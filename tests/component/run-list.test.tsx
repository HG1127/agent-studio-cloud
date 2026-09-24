import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RunFilters } from "@/features/runs/RunFilters";
import { RunList, RunPagination } from "@/features/runs/RunList";

describe("运行记录", () => {
  it("停用助手的历史运行仍然可见并有明确标记", () => {
    render(<RunList runs={[{
      id: "00000000-0000-4000-8000-000000000001",
      agentId: "00000000-0000-4000-8000-000000000002",
      agentName: "旧版合同助手",
      status: "completed",
      sourceType: "manual",
      agentArchived: true,
      startedAt: "2026-09-24T00:00:00.000Z",
      finishedAt: "2026-09-24T00:01:00.000Z",
    }]} />);
    expect(screen.getByRole("link", { name: /旧版合同助手/ })).toBeInTheDocument();
    expect(screen.getByText("助手已停用")).toBeInTheDocument();
  });

  it("筛选器保留当前条件并提供清除入口", () => {
    render(<RunFilters
      filters={{ status: "failed", sourceType: "schedule", agentId: "00000000-0000-4000-8000-000000000002" }}
      agents={[{ id: "00000000-0000-4000-8000-000000000002", name: "合同助手" }]}
    />);
    expect(screen.getByLabelText("运行状态")).toHaveValue("failed");
    expect(screen.getByLabelText("发起方式")).toHaveValue("schedule");
    expect(screen.getByLabelText("助手")).toHaveValue("00000000-0000-4000-8000-000000000002");
    expect(screen.getByRole("link", { name: "清除筛选" })).toHaveAttribute("href", "/runs");
  });

  it("翻页时保留筛选条件，第一页和末页不显示无效入口", () => {
    const filters = { status: "failed" as const, sourceType: "manual" as const };
    const { rerender } = render(<RunPagination page={2} hasNext filters={filters} />);
    expect(screen.getByText("第 2 页")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "上一页" })).toHaveAttribute("href", "/runs?status=failed&source=manual");
    expect(screen.getByRole("link", { name: "下一页" })).toHaveAttribute("href", "/runs?status=failed&source=manual&page=3");

    rerender(<RunPagination page={1} hasNext={false} filters={{}} />);
    expect(screen.queryByRole("navigation", { name: "运行记录翻页" })).not.toBeInTheDocument();
  });
});
