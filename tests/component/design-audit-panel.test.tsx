import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignAuditPanel } from "@/features/agents/DesignAuditPanel";

const { actionMock, refreshMock } = vi.hoisted(() => ({ actionMock: vi.fn(), refreshMock: vi.fn() }));
vi.mock("@/server/actions/apply-audit-fixes", () => ({ applyAuditFixesAction: actionMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));

const issue = {
  id: "issue-1", severity: "critical" as const, title: "Agent 调用缺少备用路径",
  detail: "Workflow 无法在 Agent 不可用时继续", fixable: true,
};

describe("设计检查面板", () => {
  afterEach(() => { actionMock.mockReset(); refreshMock.mockReset(); });

  it("展示中文问题并应用安全修复", async () => {
    actionMock.mockResolvedValue({ ok: true, applied: ["补充备用路径"], skipped: [], remainingCritical: 1, remainingWarnings: 0 });
    const user = userEvent.setup();
    render(<DesignAuditPanel agentId="00000000-0000-4000-8000-000000000081" score={76} issues={[issue]} />);
    expect(screen.getByText("助手 调用缺少备用路径")).toBeInTheDocument();
    expect(screen.getByText("流程 无法在 助手 不可用时继续")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "应用安全修复" }));
    await waitFor(() => expect(actionMock).toHaveBeenCalled());
    expect(await screen.findByRole("status")).toHaveTextContent("已完成 1 项安全修复");
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("没有问题时显示通过且不展示修复按钮", () => {
    render(<DesignAuditPanel agentId="00000000-0000-4000-8000-000000000081" score={100} issues={[]} />);
    expect(screen.getByText("当前设计检查通过。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "应用安全修复" })).not.toBeInTheDocument();
  });
});
