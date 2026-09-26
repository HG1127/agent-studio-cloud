import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignAuditPanel } from "@/features/agents/DesignAuditPanel";
import { DRAFT_STATE_EVENT } from "@/lib/draft-state";

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

  it("响应丢失后重试已完成的修复时提示复用当前状态", async () => {
    actionMock.mockResolvedValue({
      ok: true,
      applied: [],
      skipped: ["需要人工处理"],
      remainingCritical: 1,
      remainingWarnings: 0,
      unchanged: true,
    });
    render(<DesignAuditPanel agentId="00000000-0000-4000-8000-000000000081" score={76} issues={[issue]} />);
    await userEvent.click(screen.getByRole("button", { name: "应用安全修复" }));
    expect(await screen.findByRole("status")).toHaveTextContent("流程已经处于自动修复后的状态");
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("没有问题时显示通过且不展示修复按钮", () => {
    render(<DesignAuditPanel agentId="00000000-0000-4000-8000-000000000081" score={100} issues={[]} />);
    expect(screen.getByText("当前设计检查通过。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "应用安全修复" })).not.toBeInTheDocument();
  });

  it("可以展开查看全部设计问题", async () => {
    const issues = Array.from({ length: 10 }, (_, index) => ({
      ...issue,
      id: `issue-${index + 1}`,
      title: `问题 ${index + 1}`,
      detail: `说明 ${index + 1}`,
    }));
    const user = userEvent.setup();
    render(<DesignAuditPanel agentId="00000000-0000-4000-8000-000000000081" score={40} issues={issues} />);
    expect(screen.queryByText("问题 10")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看其他 2 项问题" }));
    expect(screen.getByText("问题 10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收起其他问题" })).toBeInTheDocument();
  });

  it("有未保存修改时阻止基于旧草稿自动修复", () => {
    render(<DesignAuditPanel agentId="00000000-0000-4000-8000-000000000081" score={76} issues={[issue]} />);
    act(() => window.dispatchEvent(new CustomEvent(DRAFT_STATE_EVENT, {
      detail: { agentId: "00000000-0000-4000-8000-000000000081", dirty: true },
    })));
    expect(screen.getByRole("button", { name: "保存后再修复" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("保存后才能应用安全修复");
    expect(actionMock).not.toHaveBeenCalled();
  });
});
