import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentList } from "@/features/agents/AgentList";
import { setAgentArchivedAction } from "@/server/actions/set-agent-archived";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/server/actions/set-agent-archived", () => ({ setAgentArchivedAction: vi.fn(async () => ({ ok: true as const })) }));

const agent = {
  id: "00000000-0000-4000-8000-0000000000a1",
  name: "合同审核助手",
  description: "检查合同风险",
  status: "published",
  versionCount: 2,
  archivedAt: null,
  updatedAt: "2026-09-24T00:00:00.000Z",
};

afterEach(() => vi.clearAllMocks());

describe("助手列表", () => {
  it("可停用在用助手", async () => {
    render(<AgentList agents={[agent]} />);
    await userEvent.click(screen.getByRole("button", { name: "停用" }));
    expect(setAgentArchivedAction).toHaveBeenCalledWith({ agentId: agent.id, archived: true });
  });

  it("已停用助手可恢复但不能进入详情", () => {
    render(<AgentList agents={[{ ...agent, archivedAt: "2026-09-24T01:00:00.000Z" }]} archived />);
    expect(screen.getByRole("button", { name: "恢复" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /合同审核助手/ })).not.toBeInTheDocument();
  });

  it("停用请求中断时显示错误并允许重试", async () => {
    vi.mocked(setAgentArchivedAction).mockRejectedValueOnce(new Error("offline"));
    render(<AgentList agents={[agent]} />);
    await userEvent.click(screen.getByRole("button", { name: "停用" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("停用失败，请检查网络后重试");
    expect(screen.getByRole("button", { name: "停用" })).toBeEnabled();
  });

  it("可以按名称或说明查找助手", async () => {
    render(<AgentList agents={[agent, { ...agent, id: "00000000-0000-4000-8000-0000000000a2", name: "报价助手", description: "生成商品报价" }]} />);
    await userEvent.type(screen.getByRole("searchbox"), "风险");
    expect(screen.getByText("合同审核助手")).toBeInTheDocument();
    expect(screen.queryByText("报价助手")).not.toBeInTheDocument();
    expect(screen.getByText("共 1 个")).toBeInTheDocument();
  });

  it("超过一页时可以翻页", async () => {
    const agents = Array.from({ length: 21 }, (_, index) => ({ ...agent, id: `agent-${index}`, name: `助手 ${index + 1}` }));
    render(<AgentList agents={agents} />);
    expect(screen.getByText("助手 1")).toBeInTheDocument();
    expect(screen.queryByText("助手 21")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByText("助手 21")).toBeInTheDocument();
    expect(screen.getByText("第 2 / 2 页")).toBeInTheDocument();
  });

  it("服务端分页模式不再对当前页做二次筛选和分页", () => {
    const agents = Array.from({ length: 20 }, (_, index) => ({ ...agent, id: `server-agent-${index}`, name: `助手 ${index + 1}` }));
    render(<AgentList agents={agents} serverManaged />);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("助手列表分页")).not.toBeInTheDocument();
    expect(screen.getByText("助手 20")).toBeInTheDocument();
  });
});
