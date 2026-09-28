import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RunFilters } from "@/features/runs/RunFilters";
import { RunFocusNav } from "@/features/runs/RunFocusNav";
import { RunList, RunPagination } from "@/features/runs/RunList";
import { runDetailHref, runsHref } from "@/features/runs/run-filter-url";
import { runReturnHref } from "@/features/runs/run-return-url";

describe("运行记录", () => {
  it("停用助手的历史运行仍然可见并有明确标记", () => {
    render(<RunList runs={[{
      id: "00000000-0000-4000-8000-000000000001",
      agentId: "00000000-0000-4000-8000-000000000002",
      agentName: "旧版合同助手",
      version: 6,
      status: "completed",
      sourceType: "manual",
      agentArchived: true,
      startedAt: "2026-09-24T00:00:00.000Z",
      finishedAt: "2026-09-24T00:01:00.000Z",
    }]} />);
    const runLink = screen.getByRole("link", { name: /旧版合同助手/ });
    expect(runLink).toBeInTheDocument();
    expect(screen.getByText("助手已停用")).toBeInTheDocument();
    expect(runLink).toHaveTextContent("版本 6");
    expect(runLink).toHaveTextContent("手动运行");
    expect(runLink).toHaveTextContent(/耗时 1 分/);
  });

  it("优先级入口只链接到后端真实支持的运行状态", () => {
    render(<RunFocusNav filters={{ status: "failed" }} />);
    expect(screen.getByRole("navigation", { name: "按任务优先级查看" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /等你处理/ })).toHaveAttribute("href", "/runs?status=waiting_approval");
    expect(screen.getByRole("link", { name: /需要处理/ })).toHaveAttribute("href", "/runs?status=failed");
    expect(screen.getByRole("link", { name: /需要处理/ })).toHaveAttribute("aria-current", "page");
  });

  it("切换优先状态时保留助手和发起方式并回到第一页", () => {
    render(<RunFocusNav filters={{ status: "running", sourceType: "schedule", agentId: "00000000-0000-4000-8000-000000000002" }} />);
    expect(screen.getByRole("link", { name: /需要处理/ })).toHaveAttribute("href", "/runs?status=failed&source=schedule&agent=00000000-0000-4000-8000-000000000002");
    expect(screen.getByRole("link", { name: /正在执行/ })).toHaveAttribute("aria-current", "page");
    expect(runsHref({ status: undefined, sourceType: "schedule", agentId: "00000000-0000-4000-8000-000000000002" })).toBe("/runs?source=schedule&agent=00000000-0000-4000-8000-000000000002");
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
    expect(screen.getByRole("status")).toHaveTextContent("当前范围：失败 · 定时任务 · 合同助手");
  });

  it("筛选无结果和首次空状态提供不同的恢复路径", () => {
    const { rerender } = render(<RunList runs={[]} filtered />);
    expect(screen.getByRole("heading", { name: "没有符合当前条件的记录" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /查看全部记录/ })).toHaveAttribute("href", "/runs");

    rerender(<RunList runs={[]} />);
    expect(screen.getByRole("heading", { name: "还没有运行记录" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /选择助手/ })).toHaveAttribute("href", "/agents");
  });

  it("页码越界时不把当前页为空误称全部无记录，并保留筛选范围", () => {
    const filters = { status: "failed" as const, sourceType: "manual" as const };
    render(<RunList runs={[]} filtered filters={filters} page={4} />);
    expect(screen.getByRole("heading", { name: "当前页没有运行记录" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /回到第一页/ })).toHaveAttribute("href", "/runs?status=failed&source=manual");
    expect(screen.queryByText("没有符合当前条件的记录")).not.toBeInTheDocument();
  });

  it("详情链接保存列表范围，返回地址只接受经契约校验的本地运行列表", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const filters = { status: "failed" as const, sourceType: "manual" as const };
    const detailHref = runDetailHref(id, filters, 3);
    expect(detailHref).toBe(`/runs/${id}?from=%2Fruns%3Fstatus%3Dfailed%26source%3Dmanual%26page%3D3`);
    expect(runReturnHref(new URL(detailHref, "https://local.invalid").searchParams.get("from") ?? undefined)).toBe("/runs?status=failed&source=manual&page=3");
    expect(runDetailHref(id, {})).toBe(`/runs/${id}`);
    expect(runReturnHref("https://outside.example/runs?status=failed")).toBe("/runs");
    expect(runReturnHref("/runs/../agents?status=failed")).toBe("/runs");
    expect(runReturnHref("/runs?status=not-a-status&page=4")).toBe("/runs");
    expect(runReturnHref("/runs?status=failed&page=99999&unknown=1")).toBe("/runs?status=failed&page=10000");
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
