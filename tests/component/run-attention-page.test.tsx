import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RunAttentionPage from "@/app/(console)/runs/attention/page";
import { RunSummary } from "@/contracts/run";

const mocks = vi.hoisted(() => ({ runs: vi.fn(), agents: vi.fn(), refresh: vi.fn() }));
vi.mock("@/server/queries/runs", () => ({ listRuns: mocks.runs, listRunAgentOptions: mocks.agents }));
vi.mock("@/server/security/query-error", () => ({ withSafeQueryError: (query: () => Promise<unknown>) => query() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

const agentId = "00000000-0000-4000-8000-000000000052";
function run(status: RunSummary["status"], index = 1) {
  return RunSummary.parse({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    agentId, agentName: `真实合同任务 ${index}`, version: 2, status,
    sourceType: "manual", agentArchived: false, startedAt: null, finishedAt: null,
  });
}
async function renderPage(params: Record<string, string> = {}) {
  render(await RunAttentionPage({ searchParams: Promise.resolve(params) }));
}

describe("桌面待处理任务", () => {
  beforeEach(() => {
    mocks.runs.mockReset().mockImplementation(async (_workspace, filters) => [run(filters.status)]);
    mocks.agents.mockReset().mockResolvedValue([{ id: agentId, name: "合同助手" }]);
    mocks.refresh.mockReset();
  });

  it("三个真实状态分别取数、独立分页，不把已读记录当成个人待办总数", async () => {
    await renderPage({ source: "manual", agent: agentId, approvalPage: "2", eventPage: "3", failedPage: "4" });
    for (const [status, offset] of [["waiting_approval", 10], ["waiting_event", 20], ["failed", 30]]) {
      expect(mocks.runs).toHaveBeenCalledWith(expect.any(String), { status, sourceType: "manual", agentId }, { limit: 11, offset });
    }
    expect(mocks.runs).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("heading", { level: 1, name: "待处理任务" })).toBeInTheDocument();
    expect(screen.getByText(/不是个人分派或审批权限清单/)).toBeInTheDocument();
    expect(screen.getAllByText("本页 1 条")).toHaveLength(3);
    expect(screen.queryByText(/待我处理|全部任务已处理/)).not.toBeInTheDocument();
    expect(screen.getByText(/可能已保存决定但还未恢复/)).toBeInTheDocument();
    expect(screen.getByText(/并非都需要手动补充/)).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "筛选待处理任务" })).toHaveAttribute("action", "/runs/attention");
    expect(screen.queryByLabelText("运行状态")).not.toBeInTheDocument();
    expect(screen.getByLabelText("助手", { exact: true })).toHaveAttribute("aria-label", "助手");
    expect(screen.getByLabelText("发起方式", { exact: true })).toHaveAttribute("aria-label", "发起方式");
    expect(screen.getByRole("link", { name: "清除筛选" })).toHaveAttribute("href", "/runs/attention");
    expect(document.body.textContent).not.toContain(agentId);
  });

  it("只显示十条并保留范围、其他分类页码及真实任务返回地址", async () => {
    mocks.runs.mockImplementation(async (_workspace, filters) => Array.from({ length: 11 }, (_, i) => run(filters.status, i + 1)));
    await renderPage({ source: "manual", agent: agentId, eventPage: "3", failedPage: "4" });
    const region = screen.getByRole("region", { name: "等待确认或恢复" });
    expect(within(region).getAllByRole("listitem")).toHaveLength(10);
    expect(within(region).getByText("本页 10 条，还有更多")).toBeInTheDocument();
    expect(within(region).queryByText("真实合同任务 11")).not.toBeInTheDocument();
    const firstRow = within(region).getAllByRole("listitem")[0];
    expect(within(firstRow).getByText("真实合同任务 1", { exact: true })).toBeInTheDocument();
    const href = within(firstRow).getByRole("link").getAttribute("href");
    expect(new URL(href!, "https://local.invalid").searchParams.get("from")).toBe(`/runs/attention?source=manual&agent=${agentId}&eventPage=3&failedPage=4`);
    const next = within(screen.getByRole("navigation", { name: "等待确认或恢复翻页" })).getByRole("link", { name: "下一页" });
    expect(next).toHaveAttribute("href", `/runs/attention?source=manual&agent=${agentId}&approvalPage=2&eventPage=3&failedPage=4#attention-approval`);
    expect(screen.queryByRole("button", { name: /批准|拒绝|重试/ })).not.toBeInTheDocument();
  });

  it.each(["waiting_approval", "waiting_event", "failed"])("%s 查询失败只影响该分类，不泄露原始错误或显示为零条", async (status) => {
    mocks.runs.mockImplementation(async (_workspace, filters) => {
      if (filters.status === status) throw new Error("private-database-secret");
      return [run(filters.status)];
    });
    await renderPage();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getAllByText("本页 1 条")).toHaveLength(2);
    expect(screen.queryByText("本页 0 条")).not.toBeInTheDocument();
    expect(screen.getByText(/不能判断是否为空/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("private-database-secret");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("助手选项失败仍保留真实列表与已选助手，应用发起方式不会扩大范围", async () => {
    mocks.agents.mockRejectedValue(new Error("private-agent-error"));
    await renderPage({ agent: agentId });
    expect(screen.getByRole("heading", { name: "助手选项暂时无法读取" })).toBeInTheDocument();
    expect(screen.getByLabelText("助手")).toBeDisabled();
    expect(screen.getByLabelText("助手")).toHaveValue(agentId);
    const form = screen.getByRole("form", { name: "筛选待处理任务" }) as HTMLFormElement;
    expect(new FormData(form).getAll("agent")).toEqual([agentId]);
    expect(screen.getByLabelText("发起方式")).toBeEnabled();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(document.body.textContent).not.toContain(agentId);
  });

  it("已选助手不在选项中时明确保留，而不是自动切换全部助手", async () => {
    mocks.agents.mockResolvedValue([]);
    await renderPage({ agent: agentId });
    expect(screen.getByLabelText("助手")).toHaveValue(agentId);
    expect(new FormData(screen.getByRole("form", { name: "筛选待处理任务" }) as HTMLFormElement).get("agent")).toBe(agentId);
    expect(screen.getByRole("status")).toHaveTextContent("当前所选助手（名称暂不可用）");
  });

  it("空页只重置对应分类，第一页空状态不称所有任务已处理", async () => {
    mocks.runs.mockResolvedValue([]);
    await renderPage({ source: "schedule", approvalPage: "9", eventPage: "3" });
    const approval = screen.getByRole("region", { name: "等待确认或恢复" });
    expect(within(approval).getByRole("heading", { name: "当前页没有记录" })).toBeInTheDocument();
    expect(within(approval).getByRole("link", { name: "回到这一类的第一页" })).toHaveAttribute("href", "/runs/attention?source=schedule&eventPage=3#attention-approval");
    expect(within(screen.getByRole("region", { name: "失败待核对" })).getByRole("heading", { name: "当前范围没有失败记录" })).toBeInTheDocument();
    expect(screen.queryByText(/全部任务已处理/)).not.toBeInTheDocument();
  });

  it("无效范围不静默扩大为全工作区查询", async () => {
    await renderPage({ agent: "not-an-agent" });
    expect(mocks.runs).not.toHaveBeenCalled();
    expect(mocks.agents).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("尚未读取任务");
    expect(screen.getByRole("link", { name: "清除无效筛选" })).toHaveAttribute("href", "/runs/attention");
  });
});
