import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";
import { CollaborationOverview } from "@/features/workflow-canvas/CollaborationOverview";
import { collaborationAgentId, collaborationCall, collaborationDraft, collaborationTarget } from "../fixtures/workflow-collaborations";

function view(draft = collaborationDraft, targets = [collaborationTarget], options = {}) {
  const onFocusNode = vi.fn(), onAdd = vi.fn();
  const props = { draft, agentId: collaborationAgentId, targets, dirty: false, disabled: false, onFocusNode, onAdd, ...options };
  return { ...render(<CollaborationOverview {...props} />), props, onFocusNode, onAdd };
}

describe("助手协作总览", () => {
  it("展示真实草稿步骤数、版本和冻结约定，不展示内部编号或静态团队成员", async () => {
    view();
    expect(screen.getByText("共 3 项协作步骤 · 呼叫 1 项 · 交接 2 项 · 0 项需核对")).toBeVisible();
    const first = within(screen.getByRole("list", { name: "协作步骤" })).getAllByRole("listitem")[0];
    await userEvent.click(within(first).getByText("查看输入和返回约定"));
    expect(within(first).getByText("冻结的任务说明")).toBeVisible();
    expect(screen.queryByText("新版名称")).not.toBeInTheDocument();
    expect(screen.getByText(/这不是正式团队成员或权限清单/)).toBeVisible();
    expect(document.body.textContent).not.toContain(collaborationTarget.versionId);
    expect(document.body.textContent).not.toContain(collaborationTarget.agentId);
  });
  it("搜索、类型筛选、需核对与清除仅影响显示，不改草稿或提交写操作", async () => {
    const { onAdd, onFocusNode } = view();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("搜索协作步骤"), "交付准备");
    expect(screen.getByRole("heading", { name: "组内交接" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "核对客户背景" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("协作类型"), "agent_call");
    expect(screen.getByText("没有符合筛选条件的协作步骤")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "清除协作筛选" }));
    await user.click(screen.getByLabelText("只看需要核对"));
    expect(screen.getByText("没有符合筛选条件的协作步骤")).toBeVisible();
    expect(onAdd).not.toHaveBeenCalled();
    expect(onFocusNode).not.toHaveBeenCalled();
  });
  it("未知原版本只有核对提醒，不给出猜测的助手链接", () => {
    view(collaborationDraft, []);
    expect(screen.getAllByText("已固定版本，当前清单未显示")).toHaveLength(3);
    expect(screen.queryByRole("link", { name: "打开接收助手工作台" })).not.toBeInTheDocument();
  });
  it("组内协作回到所属画布步骤，查看不会先发保存或启动动作", async () => {
    const { onFocusNode, onAdd } = view();
    await userEvent.click(screen.getByRole("button", { name: "编辑协作：交付准备 · 第 1 步 · 组内交接" }));
    expect(onFocusNode).toHaveBeenCalledWith("group");
    expect(onAdd).not.toHaveBeenCalled();
  });
  it("空状态和独立新增入口明确区分草稿修改与运行，禁用时不触发", async () => {
    const empty = WorkflowDraft.parse({ ...collaborationDraft, nodes: { start: { ...collaborationDraft.nodes.start, next: "done" }, done: collaborationDraft.nodes.done } });
    const { rerender, props, onAdd } = view(empty);
    expect(screen.getByText("当前草稿还没有助手协作步骤")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "添加独立交接步骤" }));
    expect(onAdd).toHaveBeenCalledWith("handoff");
    rerender(<CollaborationOverview {...props} disabled />);
    expect(screen.getByRole("button", { name: "添加独立呼叫步骤" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "添加独立呼叫步骤" }));
    expect(onAdd).toHaveBeenCalledOnce();
  });
  it("分页后筛选回到第一页，草稿减少时页码保持有效，不显示假空页", async () => {
    const nodes = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`call_${index}`, { ...collaborationCall, id: `call_${index}`, title: `背景核对 ${index + 1}`, next: index < 11 ? `call_${index + 1}` : "done" }]));
    const many = WorkflowDraft.parse({ ...collaborationDraft, nodes: { start: { ...collaborationDraft.nodes.start, next: "call_0" }, ...nodes, done: collaborationDraft.nodes.done } });
    const { props, rerender } = view(many);
    const user = userEvent.setup();
    expect(screen.getByText("显示第 1–10 项，共 12 项")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "下一页协作" }));
    expect(screen.getByText("显示第 11–12 项，共 12 项")).toBeVisible();
    rerender(<CollaborationOverview {...props} draft={collaborationDraft} />);
    expect(screen.getByText("显示第 1–3 项，共 3 项")).toBeVisible();
    fireEvent.change(screen.getByLabelText("搜索协作步骤"), { target: { value: "客户背景" } });
    expect(screen.getByText("显示第 1–1 项，共 1 项")).toBeVisible();
  });
  it("外部草稿修改即时更新显示与未保存状态，不复用另一份协作草稿", () => {
    const { props, rerender } = view();
    const changed = WorkflowDraft.parse({ ...collaborationDraft, nodes: { ...collaborationDraft.nodes, call: { ...collaborationCall, title: "复核业务背景" } } });
    rerender(<CollaborationOverview {...props} draft={changed} dirty />);
    expect(screen.getByRole("heading", { name: "复核业务背景" })).toBeVisible();
    expect(screen.getByText("包含未保存修改")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "核对客户背景" })).not.toBeInTheDocument();
  });
});
