import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignAuditPanel } from "@/features/agents/DesignAuditPanel";
import { AuditIssueView } from "@/contracts/audit";
import { DRAFT_STATE_EVENT } from "@/lib/draft-state";
import { WORKFLOW_NODE_FOCUS_EVENT, type WorkflowNodeFocusDetail } from "@/lib/workflow-node-focus";

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
    expect(actionMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认修复已保存流程" }));
    await waitFor(() => expect(actionMock).toHaveBeenCalled());
    expect(await screen.findByRole("region", { name: "本次修复返回结果" })).toHaveTextContent("已完成 1 项安全修复");
    expect(screen.getByRole("list", { name: "已完成的修复" })).toHaveTextContent("补充备用路径");
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("面向员工的审计说明不暴露业务规格内部字段名", () => {
    render(<DesignAuditPanel agentId="00000000-0000-4000-8000-000000000081" score={76} issues={[
      { ...issue, title: "业务节点没有业务规格", detail: "没有 businessSpec，也没有声明 scope 或 registryTool。" },
    ]} />);
    expect(screen.getByText("没有 业务规格，也没有声明 权限范围 或 已注册业务工具。")).toBeVisible();
    expect(screen.queryByText(/businessSpec|registryTool|scope/)).not.toBeInTheDocument();
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
    await userEvent.click(screen.getByRole("button", { name: "确认修复已保存流程" }));
    expect(await screen.findByRole("region", { name: "本次修复返回结果" })).toHaveTextContent("本次没有写入新的修复");
    expect(screen.getByRole("list", { name: "未完成的自动修复" })).toHaveTextContent("需要人工处理");
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

  it("后端未提供步骤关联时只提供当前流程入口，不猜测具体步骤或写入", async () => {
    const events: WorkflowNodeFocusDetail[] = [];
    const receive = (event: Event) => events.push((event as CustomEvent<WorkflowNodeFocusDetail>).detail);
    window.addEventListener(WORKFLOW_NODE_FOCUS_EVENT, receive);
    try {
      render(<DesignAuditPanel agentId="00000000-0000-4000-8000-000000000081" score={76} issues={[
        AuditIssueView.parse(issue),
        AuditIssueView.parse({ ...issue, id: "step_1", title: "步骤 step_1 需要核对" }),
      ]} />);
      expect(screen.getByText(/当前检查结果未提供具体步骤关联/)).toBeVisible();
      const link = screen.getByRole("link", { name: "查看当前流程" });
      expect(link).toHaveAttribute("href", "#workflow");
      await userEvent.click(link);
      expect(screen.queryByRole("button", { name: "在流程中查看" })).not.toBeInTheDocument();
      expect(events).toEqual([]);
      expect(actionMock).not.toHaveBeenCalled();
      expect(refreshMock).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(WORKFLOW_NODE_FOCUS_EVENT, receive);
    }
  });

  it("有未保存修改时阻止基于旧草稿自动修复", () => {
    render(<DesignAuditPanel agentId="00000000-0000-4000-8000-000000000081" score={76} issues={[issue]} />);
    act(() => window.dispatchEvent(new CustomEvent(DRAFT_STATE_EVENT, {
      detail: { agentId: "00000000-0000-4000-8000-000000000081", dirty: true },
    })));
    expect(screen.getByRole("button", { name: "保存后再修复" })).toBeDisabled();
    expect(screen.getAllByRole("status").some((status) => status.textContent?.includes("保存后才能应用安全修复"))).toBe(true);
    expect(actionMock).not.toHaveBeenCalled();
  });

  it("真实分级概览不随筛选变化，级别与处理方式可以组合查找", async () => {
    const user = userEvent.setup();
    render(<DesignAuditPanel agentId="agent" score={60} issues={[
      issue,
      { ...issue, id: "warning", severity: "warning", fixable: false, title: "人工核对路径", detail: "需要员工确认" },
      { ...issue, id: "info", severity: "info", fixable: false, title: "补充说明", detail: "提升业务交付清晰度" },
    ]} />);
    expect(screen.getByLabelText("设计问题概览")).toHaveTextContent("阻塞问题1待复核1改进建议1");
    await user.selectOptions(screen.getByLabelText("问题级别"), "warning");
    await user.selectOptions(screen.getByLabelText("处理方式"), "manual");
    await user.type(screen.getByLabelText("查找设计问题"), "员工确认");
    expect(within(screen.getByRole("list", { name: "设计问题列表" })).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("人工核对路径")).toBeVisible();
    expect(screen.queryByText("补充说明")).not.toBeInTheDocument();
    expect(screen.getByLabelText("设计问题概览")).toHaveTextContent("阻塞问题1待复核1改进建议1");
    await user.click(screen.getByRole("button", { name: "清除筛选" }));
    expect(within(screen.getByRole("list", { name: "设计问题列表" })).getAllByRole("listitem")).toHaveLength(3);
  });

  it("空筛选不冒充检查通过，并可恢复完整问题列表", async () => {
    render(<DesignAuditPanel agentId="agent" score={76} issues={[issue]} />);
    await userEvent.type(screen.getByLabelText("查找设计问题"), "不存在的问题");
    expect(screen.getByText(/没有符合筛选的设计问题/)).toBeVisible();
    expect(screen.queryByText("当前设计检查通过。")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "应用安全修复" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "查看全部问题" }));
    expect(screen.getByRole("list", { name: "设计问题列表" })).toBeVisible();
  });

  it("修复确认明确全部已保存问题，不按筛选提交，取消和键盘返回不写入", async () => {
    const user = userEvent.setup();
    render(<DesignAuditPanel agentId="agent" score={76} issues={[issue]} />);
    await user.type(screen.getByLabelText("查找设计问题"), "没有命中");
    const trigger = screen.getByRole("button", { name: "应用安全修复" });
    await user.click(trigger);
    expect(screen.getByRole("dialog")).toHaveTextContent("全部可自动修复问题，不限于当前筛选结果");
    expect(screen.getByRole("dialog")).toHaveTextContent("当前没有逐条修复预览");
    await user.click(screen.getByRole("button", { name: "返回" }));
    expect(actionMock).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(actionMock).not.toHaveBeenCalled();
  });

  it("确认过程中出现未保存修改时关闭弹窗，不调用修复", async () => {
    render(<DesignAuditPanel agentId="agent" score={76} issues={[issue]} />);
    await userEvent.click(screen.getByRole("button", { name: "应用安全修复" }));
    act(() => window.dispatchEvent(new CustomEvent(DRAFT_STATE_EVENT, { detail: { agentId: "agent", dirty: true } })));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存后再修复" })).toBeDisabled();
    expect(actionMock).not.toHaveBeenCalled();
  });

  it("不接受其他助手的草稿事件，重新读取保留本页未保存状态", async () => {
    render(<DesignAuditPanel agentId="agent" score={76} issues={[issue]} />);
    act(() => window.dispatchEvent(new CustomEvent(DRAFT_STATE_EVENT, { detail: { agentId: "other", dirty: true } })));
    expect(screen.getByRole("button", { name: "应用安全修复" })).toBeEnabled();
    act(() => window.dispatchEvent(new CustomEvent(DRAFT_STATE_EVENT, { detail: { agentId: "agent", dirty: true } })));
    await userEvent.click(screen.getByRole("button", { name: "重新读取设计检查" }));
    expect(refreshMock).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "保存后再修复" })).toBeDisabled();
    expect(actionMock).not.toHaveBeenCalled();
  });

  it("等待实际修复时阻止取消、重新读取和重复提交", async () => {
    let finish!: (value: unknown) => void;
    actionMock.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const user = userEvent.setup();
    render(<DesignAuditPanel agentId="agent" score={76} issues={[issue]} />);
    const reread = screen.getByRole("button", { name: "重新读取设计检查" });
    await user.click(screen.getByRole("button", { name: "应用安全修复" }));
    await user.dblClick(screen.getByRole("button", { name: "确认修复已保存流程" }));
    expect(actionMock).toHaveBeenCalledExactlyOnceWith("agent");
    expect(screen.getByRole("button", { name: "正在处理…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "返回" })).toBeDisabled();
    expect(reread).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeVisible();
    await act(async () => finish({ ok: true, applied: ["修复一项"], skipped: [], remainingCritical: 0, remainingWarnings: 0 }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "本次修复返回结果" })).toHaveTextContent("修复一项");
  });

  it("显示后端已完成与跳过条目及真实剩余数，不凭条目数删除设计问题", async () => {
    actionMock.mockResolvedValue({ ok: true, applied: ["补充 Workflow 路径"], skipped: ["Agent 需要人工确认"], remainingCritical: 3, remainingWarnings: 2 });
    render(<DesignAuditPanel agentId="agent" score={76} issues={[issue]} />);
    await userEvent.click(screen.getByRole("button", { name: "应用安全修复" }));
    await userEvent.click(screen.getByRole("button", { name: "确认修复已保存流程" }));
    const result = await screen.findByRole("region", { name: "本次修复返回结果" });
    expect(result).toHaveTextContent("剩余 3 个阻塞问题、2 个待复核问题");
    expect(within(result).getByRole("list", { name: "已完成的修复" })).toHaveTextContent("补充 流程 路径");
    expect(within(result).getByRole("list", { name: "未完成的自动修复" })).toHaveTextContent("助手 需要人工确认");
    expect(screen.getByText("助手 调用缺少备用路径")).toBeVisible();
    expect(result).not.toHaveTextContent("当前设计检查通过");
  });

  it("业务失败使用真实错误，不显示修复成功或刷新", async () => {
    actionMock.mockResolvedValue({ ok: false, error: "Workflow 已不存在，请重新读取" });
    render(<DesignAuditPanel agentId="agent" score={76} issues={[issue]} />);
    await userEvent.click(screen.getByRole("button", { name: "应用安全修复" }));
    await userEvent.click(screen.getByRole("button", { name: "确认修复已保存流程" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("流程 已不存在，请重新读取");
    expect(screen.queryByRole("region", { name: "本次修复返回结果" })).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it.each(["rejected", "invalid"])("%s 修复响应不冒充成功，先重新读取再允许确认", async (kind) => {
    if (kind === "rejected") actionMock.mockRejectedValue(new Error("offline"));
    else actionMock.mockResolvedValue({ ok: true, applied: ["看似成功"] });
    render(<DesignAuditPanel agentId="agent" score={76} issues={[issue]} />);
    await userEvent.click(screen.getByRole("button", { name: "应用安全修复" }));
    await userEvent.click(screen.getByRole("button", { name: "确认修复已保存流程" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时无法确认安全修复是否完成");
    expect(screen.getByRole("button", { name: "重新读取后再修复" })).toBeDisabled();
    expect(screen.queryByRole("region", { name: "本次修复返回结果" })).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "重新读取设计检查" }));
    expect(refreshMock).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "应用安全修复" })).toBeEnabled();
    expect(actionMock).toHaveBeenCalledOnce();
    expect(screen.queryByRole("region", { name: "本次修复返回结果" })).not.toBeInTheDocument();
  });
});
