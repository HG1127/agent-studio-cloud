import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RunSummary } from "@/contracts/run";
import { RunCollaborationSection } from "@/features/runs/RunCollaborationSection";
import { collaborationView, collaborationDate, collaborationDuration } from "@/features/runs/run-collaboration-view";
import { collaborationNavigation } from "@/features/runs/run-collaboration-navigation";

const parentId = "00000000-0000-4000-8000-000000000001";
function child(index = 1, overrides: Partial<RunSummary> = {}) {
  return RunSummary.parse({ id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`, agentId: parentId, agentName: `核对助手 ${index}`,
    status: "completed", sourceType: "agent_call", version: 2, startedAt: "2026-10-08T01:00:00.000Z", finishedAt: "2026-10-08T01:00:01.000Z", ...overrides });
}
const defaults = { runId: parentId, backHref: "/runs?source=manual&page=3", state: { query: "", page: 1 } };

describe("真实直接协作记录的桌面工作台", () => {
  it("使用实际版本、方式、北京时间；停用或版本缺失仍可进入真实任务", () => {
    const runs = [child(1, { agentArchived: true }), child(2, { sourceType: "handoff", version: null, startedAt: null, finishedAt: null })];
    const { container } = render(<RunCollaborationSection {...defaults} runs={runs} />);
    const table = screen.getByRole("table");
    expect(table).toHaveTextContent("固定运行版本：版本 2");
    expect(table).toHaveTextContent("助手已停用，历史任务仍可查看");
    expect(table).toHaveTextContent("运行版本信息不可用");
    expect(table).toHaveTextContent("尚未保存开始时间");
    expect(table).toHaveTextContent("2026/10/08 09:00:00");
    expect(within(table).getByText("助手交接")).toBeVisible();
    const link = screen.getByRole("link", { name: "查看子任务：核对助手 1" });
    const url = new URL(link.getAttribute("href")!, "https://local.invalid");
    expect(url.pathname).toBe(`/runs/${runs[0].id}`);
    expect(collaborationNavigation(Object.fromEntries(url.searchParams)).parent?.runId).toBe(parentId);
    expect(container.textContent).not.toContain(parentId);
  });
  it("读取失败没有零计数、空状态、过滤表单或可疑子任务链接", () => {
    render(<RunCollaborationSection {...defaults} runs={null} />);
    expect(screen.getByRole("alert")).toHaveTextContent("不能将暂不可读计为零");
    expect(screen.queryByRole("definition")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.queryByText("本次尚未读到协作子任务")).not.toBeInTheDocument();
  });
  it("成功空清单只陈述本次读取为空，不声称无需协作", () => {
    render(<RunCollaborationSection {...defaults} runs={[]} />);
    expect(screen.getByRole("heading", { name: "本次尚未读到协作子任务" })).toBeVisible();
    expect(screen.getByText("当前没有已读到的直接协作记录，不代表后续不会产生子任务。")).toBeVisible();
    expect(screen.getAllByRole("definition")).toHaveLength(5);
    expect(screen.getAllByRole("definition").every((entry) => entry.textContent === "0")).toBe(true);
  });
  it("筛选只匹配名称和真实方式状态；汇总仍基于本次读取，不冒充匹配总数", () => {
    const runs = [child(1, { agentName: "客户核对", status: "failed", sourceType: "handoff" }), child(2, { agentName: "客户核对", status: "waiting_approval" }), child(3, { status: "running" }), child(4, { status: "cancelled" })];
    const state = { query: "客户", sourceType: "handoff" as const, status: "failed" as const, page: 1 };
    const view = collaborationView(runs, state);
    expect(view.rows.map((run) => run.id)).toEqual([runs[0].id]);
    expect(view.summary).toEqual({ total: 4, active: 1, attention: 2, completed: 0, cancelled: 1 });
    render(<RunCollaborationSection {...defaults} state={state} runs={runs} />);
    expect(screen.getByRole("status")).toHaveTextContent("共 1 项匹配记录");
    expect(screen.getByRole("searchbox", { name: "搜索协作助手" })).toHaveValue("客户");
    expect(screen.getByRole("combobox", { name: "子任务状态" })).toHaveValue("failed");
    expect(screen.getByRole("link", { name: "清除协作筛选" })).toHaveAttribute("href", `/runs/${parentId}?from=%2Fruns%3Fsource%3Dmanual%26page%3D3#collaboration`);
  });
  it("每页十项、按接口顺序排列，链接保留本页和外层范围", () => {
    const runs = Array.from({ length: 22 }, (_, index) => child(index + 1));
    render(<RunCollaborationSection {...defaults} state={{ query: "", page: 2 }} runs={runs} />);
    expect(screen.getAllByRole("row")).toHaveLength(11);
    expect(screen.getByRole("status")).toHaveTextContent("显示第 11–20 项，共 22 项匹配记录");
    const link = new URL(screen.getByRole("link", { name: "查看子任务：核对助手 11" }).getAttribute("href")!, "https://local.invalid");
    expect(link.searchParams.get("parentPage")).toBe("2");
    expect(link.searchParams.get("from")).toBe(defaults.backHref);
    expect(screen.getByRole("link", { name: "下一页" }).getAttribute("href")).toContain("colPage=3");
  });
  it("越界页不自动换页；回到第一页保留条件与核对过的上级位置", () => {
    const state = { query: "客户", page: 3 };
    const parent = { runId: child(20).id, state: { query: "原位置", page: 2 } };
    render(<RunCollaborationSection {...defaults} state={state} parent={parent} runs={[child(1, { agentName: "客户核对" })]} />);
    expect(screen.getByRole("heading", { name: "当前页没有协作子任务" })).toBeVisible();
    const url = new URL(screen.getByRole("link", { name: "回到协作第一页" }).getAttribute("href")!, "https://local.invalid");
    const parsed = collaborationNavigation(Object.fromEntries(url.searchParams));
    expect(parsed.state).toEqual({ query: "客户", page: 1 });
    expect(parsed.parent).toEqual(parent);
    const form = screen.getByRole("form", { name: "筛选协作子任务" });
    expect(form).toHaveAttribute("method", "get");
    expect(form.querySelector('input[name="parentQuery"]')).toHaveValue("原位置");
    expect(form.querySelector('input[name="colPage"]')).toBeNull();
  });
  it("无匹配和非法筛选各有明确反馈，查询标识不算名称", () => {
    const runs = [child()];
    const { rerender } = render(<RunCollaborationSection {...defaults} state={{ query: runs[0].id, page: 1 }} runs={runs} />);
    expect(screen.getByRole("heading", { name: "没有符合条件的协作子任务" })).toBeVisible();
    rerender(<RunCollaborationSection {...defaults} invalidState runs={runs} />);
    expect(screen.getByRole("alert")).toHaveTextContent("协作筛选条件无法读取");
    expect(screen.getByRole("searchbox", { name: "搜索协作助手" })).toHaveValue("");
    expect(screen.getByRole("table")).toBeVisible();
  });
  it("未完成记录不估算活动耗时；实际零秒保留，时间格式与逆序单独提示", () => {
    expect(collaborationDuration({ startedAt: "2026-10-08T01:00:00Z", finishedAt: null })).toBeNull();
    expect(collaborationDuration({ startedAt: "2026-10-08T01:00:00Z", finishedAt: "2026-10-08T01:00:00Z" })).toBe("0 秒");
    expect(collaborationDuration({ startedAt: "2026-10-08T01:00:00Z", finishedAt: "2026-10-08T00:00:00Z" })).toBe("时间记录待核对");
    expect(collaborationDuration({ startedAt: "2026-10-08T01:00:00Z", finishedAt: "2026-10-08T02:01:05Z" })).toBe("1 小时 1 分");
    expect(collaborationDate(null)).toBeNull();
    expect(collaborationDate("not-date")).toBe("时间记录不可读");
  });
  it("不把其他真实来源类型别名为助手协作", () => {
    render(<RunCollaborationSection {...defaults} runs={[child(1, { sourceType: "schedule" })]} />);
    expect(screen.getByRole("table")).toHaveTextContent("定时任务");
    expect(screen.getByRole("table")).not.toHaveTextContent("助手协作");
  });
});
