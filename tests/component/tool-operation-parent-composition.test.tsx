import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunView } from "@/contracts/run";
import { toolOperationsHref } from "@/features/tool-operations/tool-operation-navigation";

const mocks = vi.hoisted(() => ({ run: vi.fn(), listRuns: vi.fn(), agents: vi.fn(), pathname: "/tool-operations", refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname, useRouter: () => ({ refresh: mocks.refresh }), notFound: () => { throw new Error("not-found"); } }));
vi.mock("@/server/queries/runs", () => ({ getRunView: mocks.run, listRuns: mocks.listRuns, listRunAgentOptions: mocks.agents,
  listRunSteps: async () => [], listApprovals: async () => [], listChildRuns: async () => [], getPendingWait: async () => null }));
vi.mock("@/server/queries/trace", () => ({ listRecentTrace: async () => [] }));
vi.mock("@/server/queries/run-feedback", () => ({ getRunFeedback: async () => null }));
vi.mock("@/features/runs/RunModelUsagePanel", () => ({ RunModelUsagePanel: () => <p>用量入口保留</p> }));
vi.mock("@/features/runs/TraceTimeline", () => ({ TraceTimeline: () => <p>执行轨迹保留</p> }));
vi.mock("@/features/runs/ApprovalPanel", () => ({ ApprovalPanel: () => null }));
vi.mock("@/features/runs/CancelRunButton", () => ({ CancelRunButton: () => null }));
vi.mock("@/features/runs/RetryRunButton", () => ({ RetryRunButton: () => null }));
vi.mock("@/features/runs/ResumeRunStartButton", () => ({ ResumeRunStartButton: () => null }));
vi.mock("@/features/runs/WaitEventPanel", () => ({ WaitEventPanel: () => null }));
vi.mock("@/features/runs/RunFeedbackPanel", () => ({ RunFeedbackPanel: () => null }));

import ConsoleLayout from "@/app/(console)/layout";
import RunAttentionPage from "@/app/(console)/runs/attention/page";
import { RunDetail } from "@/features/runs/RunDetail";

const runId = "00000000-0000-4000-8000-0000000000ab", otherId = "00000000-0000-4000-8000-0000000000ac";
const saved = RunView.parse({ id: runId, agentId: otherId, agentName: "需求核对助手", status: "completed", version: 1,
  input: { request: "实际输入" }, result: { response: "实际交付" }, error: null, startedAt: null, finishedAt: "2026-10-09T10:00:00.000Z" });
beforeEach(() => { vi.clearAllMocks(); mocks.pathname = "/tool-operations"; mocks.run.mockResolvedValue(saved); mocks.listRuns.mockResolvedValue([]); mocks.agents.mockResolvedValue([]); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({}))); });
afterEach(() => vi.unstubAllGlobals());

describe("真实全站与运行页面的工具核对组装", () => {
  it("桌面主导航与当前位置覆盖核对页面，不误选运行记录", () => {
    render(<ConsoleLayout><p>核对页面内容</p></ConsoleLayout>);
    expect(within(screen.getByRole("navigation", { name: "主导航" })).getByRole("link", { name: "工具结果核对" })).toHaveAttribute("href", "/tool-operations");
    expect(screen.getByRole("link", { name: "工具结果核对" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("navigation", { name: "当前位置" })).toHaveTextContent("工具结果核对");
    expect(within(screen.getByRole("navigation", { name: "主导航" })).getByRole("link", { name: "处理记录" })).not.toHaveAttribute("aria-current");
  });
  it("待处理页面提供独立工作区核对入口，不复制助手或来源筛选、不虚构待办数", async () => {
    render(await RunAttentionPage({ searchParams: Promise.resolve({ agent: otherId, source: "manual" }) }));
    const entry = screen.getByRole("complementary", { name: "业务工具结果核对入口" });
    expect(within(entry).getByRole("link", { name: "查看待核对的业务工具" })).toHaveAttribute("href", "/tool-operations?status=blocked");
    expect(entry).toHaveTextContent("不沿用下方助手或发起方式筛选"); expect(entry).toHaveTextContent("不自动恢复旧任务");
    expect(entry.textContent).not.toContain(otherId); expect(mocks.listRuns).toHaveBeenCalledTimes(3);
    for (const call of mocks.listRuns.mock.calls) expect(call[1]).toMatchObject({ agentId: otherId, sourceType: "manual" });
  });
  it("运行详情提供真实源任务范围入口，保留原输入、结果和执行证据", async () => {
    const { container } = render(await RunDetail({ runId }));
    expect(screen.getByRole("link", { name: "业务操作记录" })).toHaveAttribute("href", toolOperationsHref({ sourceRunId: runId, limit: 20 }));
    expect(within(container.querySelector("#input") as HTMLElement).getByText("实际输入")).toBeVisible();
    expect(within(container.querySelector("#result") as HTMLElement).getByText("实际交付")).toBeVisible();
    expect(screen.getByText("执行轨迹保留")).toBeVisible(); expect(screen.getByText("用量入口保留")).toBeVisible();
    expect(container.textContent).not.toContain(runId);
  });
  it("返回核对列表保留配对游标，实际源任务匹配后使用专属标签", async () => {
    const href = toolOperationsHref({ sourceRunId: runId, status: "blocked", limit: 5, before: "2026-10-09T00:00:00.123456Z", beforeId: otherId });
    render(await RunDetail({ runId, backHref: href }));
    expect(screen.getByRole("link", { name: "返回工具核对列表" })).toHaveAttribute("href", href);
  });
  it.each(["/tool-operations?sourceRunId=" + otherId, "/tool-operations?status=blocked&status=completed", "/tool-operations?agent=" + otherId])("伪造或无效核对返回范围回退运行列表 %#", async (backHref) => {
    render(await RunDetail({ runId, backHref }));
    expect(screen.getByRole("link", { name: "返回运行记录" })).toHaveAttribute("href", "/runs");
    expect(screen.queryByRole("link", { name: "返回工具核对列表" })).not.toBeInTheDocument();
  });
});
