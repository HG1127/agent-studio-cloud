import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkflowDraft } from "@/contracts/workflow";
import { NodeRoutesEditor } from "@/features/workflow-canvas/NodeRoutesEditor";

const draft = WorkflowDraft.parse({
  id: "route-editor",
  startNodeId: "start",
  rootAgent: { id: "agent", name: "测试助手", role: "处理" },
  memoryPolicy: { taskContext: true, longTerm: false },
  nodes: {
    start: { id: "start", title: "开始", type: "trigger", next: "approval" },
    approval: {
      id: "approval", title: "安全确认", type: "human", next: "work", rejectNext: "done",
      approval: { role: "负责人", reason: "确认" }, controlPlane: { kind: "governance", hiddenByDefault: true },
    },
    work: { id: "work", title: "执行工作", type: "ai", next: "done" },
    done: { id: "done", title: "完成", type: "end" },
  },
});

describe("节点路径设置", () => {
  it("隐藏控制路径在显示前只读，显示后可选择真实目标", async () => {
    const onRouteChange = vi.fn();
    const onRevealControlNodes = vi.fn();
    const user = userEvent.setup();
    const props = { node: draft.nodes.start, nodes: draft.nodes, onRouteChange, onDisconnectIncoming: vi.fn(), onRevealControlNodes, onFocusNode: vi.fn() };
    const { rerender } = render(<NodeRoutesEditor {...props} showControlNodes={false} />);
    expect(screen.getByRole("combobox", { name: "完成后的目标步骤" })).toBeDisabled();
    expect(screen.getByText("经隐藏控制检查")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "显示控制节点" }));
    expect(onRevealControlNodes).toHaveBeenCalledOnce();

    rerender(<NodeRoutesEditor {...props} showControlNodes />);
    await user.selectOptions(screen.getByRole("combobox", { name: "完成后的目标步骤" }), "work");
    expect(onRouteChange).toHaveBeenCalledWith("next", "work");
  });

  it("列出可导航的上游来源但不暴露未展开控制节点", async () => {
    const onFocusNode = vi.fn();
    const onRouteChange = vi.fn();
    const user = userEvent.setup();
    render(<NodeRoutesEditor node={draft.nodes.work} nodes={draft.nodes} showControlNodes={false}
      onRouteChange={onRouteChange} onDisconnectIncoming={vi.fn()} onRevealControlNodes={vi.fn()} onFocusNode={onFocusNode} />);
    expect(screen.getByRole("button", { name: /另有 1 条控制检查路径/ })).toBeVisible();
    expect(screen.queryByRole("button", { name: /安全确认 ·/ })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "完成后的目标步骤" }), "");
    expect(onRouteChange).toHaveBeenCalledWith("next", null);
    expect(onFocusNode).not.toHaveBeenCalled();
  });

  it("断开可见上游前要求确认具体来源和路径", async () => {
    const onDisconnectIncoming = vi.fn();
    const user = userEvent.setup();
    render(<NodeRoutesEditor node={draft.nodes.done} nodes={draft.nodes} showControlNodes={false}
      onRouteChange={vi.fn()} onDisconnectIncoming={onDisconnectIncoming} onRevealControlNodes={vi.fn()} onFocusNode={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /断开来自安全确认/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "断开来自执行工作的正常流转路径" }));
    expect(screen.getByRole("dialog", { name: "断开这条上游路径？" })).toHaveTextContent("将不再进入“完成”");
    expect(onDisconnectIncoming).not.toHaveBeenCalled();
    await user.click(within(screen.getByRole("dialog", { name: "断开这条上游路径？" })).getByRole("button", { name: "断开路径" }));
    expect(onDisconnectIncoming).toHaveBeenCalledWith("work", "next", "done");
  });
});
