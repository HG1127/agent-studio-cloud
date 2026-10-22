import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentList } from "@/features/agents/AgentList";
import { AgentSummary } from "@/contracts/agent";
import { RunListFilters } from "@/contracts/run";
import { AttentionListState, attentionHref, attentionStateFromSearch } from "@/features/runs/run-attention-url";
import { runsHref } from "@/features/runs/run-filter-url";

const mocks = vi.hoisted(() => ({ archive: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/server/actions/set-agent-archived", () => ({ setAgentArchivedAction: mocks.archive }));

const first = AgentSummary.parse({ id: "00000000-0000-4000-8000-0000000000ab", name: "合同核对助手", description: "核对合同风险", status: "draft", versionCount: 0, archivedAt: null, updatedAt: "2026-10-12T00:00:00Z" });
const second = AgentSummary.parse({ ...first, id: "00000000-0000-4000-8000-0000000000ac", name: "库存统计助手", description: "统计库存余量" });

beforeEach(() => { vi.clearAllMocks(); mocks.archive.mockReset().mockResolvedValue({ ok: true }); });
afterEach(() => { vi.restoreAllMocks(); });

describe("真实助手卡片的同助手只读运行入口", () => {
  it("两张在用卡片分别生成共享契约认可的待处理与运行地址，不借用其他助手范围", () => {
    render(<AgentList agents={[first, second]} serverManaged />);
    for (const agent of [first, second]) {
      const nav = screen.getByRole("navigation", { name: agent.name + "的运行入口" });
      const filters = RunListFilters.parse({ agentId: agent.id });
      const attention = AttentionListState.parse(filters);
      const pending = within(nav).getByRole("link", { name: "查看待处理任务" });
      const history = within(nav).getByRole("link", { name: "查看运行记录" });
      expect(pending).toHaveAttribute("href", attentionHref(attention));
      expect(history).toHaveAttribute("href", runsHref(filters));
      expect(attentionStateFromSearch(Object.fromEntries(new URL(pending.getAttribute("href")!, "http://localhost").searchParams))).toEqual({ success: true, data: attention });
      expect(nav.closest("a")).toBeNull();
      expect(nav.querySelector("a a")).toBeNull();
    }
    expect(screen.queryByText(/没有待办|最近结果已读取|最近一次/)).not.toBeInTheDocument();
    expect(mocks.archive).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("合法大写编号规范化，换到不同助手后两个入口均不保留旧范围", () => {
    const view = render(<AgentList agents={[{ ...first, id: first.id.toUpperCase() }]} serverManaged />);
    expect(screen.getByRole("link", { name: "查看待处理任务" })).toHaveAttribute("href", `/runs/attention?agent=${first.id}`);
    expect(screen.getByRole("link", { name: "查看运行记录" })).toHaveAttribute("href", `/runs?agent=${first.id}`);
    view.rerender(<AgentList agents={[second]} serverManaged />);
    const nav = screen.getByRole("navigation", { name: second.name + "的运行入口" });
    for (const link of within(nav).getAllByRole("link")) {
      expect(link.getAttribute("href")).toContain(second.id);
      expect(link.getAttribute("href")).not.toContain(first.id);
      expect(new URL(link.getAttribute("href")!, "http://localhost").searchParams.size).toBe(1);
    }
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it.each(["", "other", "../agents", "//example.com", first.id + " "])("无效编号不生成全部运行或另一助手入口：%s", (id) => {
    render(<AgentList agents={[{ ...first, id }]} serverManaged />);
    expect(screen.queryByRole("link", { name: "查看待处理任务" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "查看运行记录" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: first.name + "的运行入口" })).not.toBeInTheDocument();
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it("列表查找只呈现匹配卡片的入口，清除后恢复原有两张卡片", async () => {
    render(<AgentList agents={[first, second]} />);
    const search = screen.getByRole("searchbox");
    await userEvent.type(search, "库存");
    expect(screen.queryByRole("navigation", { name: first.name + "的运行入口" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: second.name + "的运行入口" })).toBeVisible();
    await userEvent.clear(search);
    expect(screen.getByRole("navigation", { name: first.name + "的运行入口" })).toBeVisible();
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it("已停用卡片不出现新增入口，原恢复动作和定时任务保护文案不变", async () => {
    render(<AgentList agents={[{ ...first, archivedAt: "2026-10-12T01:00:00Z" }]} archived serverManaged />);
    expect(screen.queryByRole("navigation", { name: first.name + "的运行入口" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "查看运行记录" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /合同核对助手/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "恢复" }));
    expect(mocks.archive).toHaveBeenCalledWith({ agentId: first.id, archived: false });
    expect(await screen.findByRole("status")).toHaveTextContent("关联的定时任务仍需单独恢复");
  });

  it("记录已停用但列表标志尚未同步时也不借新导航开放运行范围", () => {
    render(<AgentList agents={[{ ...first, archivedAt: "2026-10-12T01:00:00Z" }]} serverManaged />);
    expect(screen.queryByRole("link", { name: "查看待处理任务" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "查看运行记录" })).not.toBeInTheDocument();
  });

  it("原停用仍需确认，未知回执只读核对不改成明确失败或自动重复写", async () => {
    mocks.archive.mockRejectedValueOnce(new Error("response lost"));
    render(<AgentList agents={[first]} serverManaged />);
    await userEvent.click(screen.getByRole("button", { name: "停用" }));
    expect(screen.getByRole("dialog", { name: "停用「合同核对助手」？" })).toHaveTextContent("关联的定时任务会暂停");
    expect(mocks.archive).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "确认停用" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法确认「合同核对助手」是否已停用");
    expect(mocks.archive).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "刷新列表核对" }));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.archive).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "查看待处理任务" })).toHaveAttribute("href", attentionHref(AttentionListState.parse({ agentId: first.id })));
  });
});
