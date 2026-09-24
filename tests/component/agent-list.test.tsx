import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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
});
