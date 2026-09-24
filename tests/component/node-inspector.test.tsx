import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import { NodeInspector } from "@/features/workflow-canvas/NodeInspector";

const AI_NODE = WorkflowNode.parse({ id: "step_1", title: "生成回复方案", type: "ai" });
const HUMAN_NODE = WorkflowNode.parse({
  id: "step_2",
  title: "负责人确认发送内容",
  type: "human",
  approval: { role: "客服主管", reason: "确认内容无误后再发送" },
});
const CONDITION_NODE = WorkflowNode.parse({
  id: "step_3",
  title: "分情况处理",
  type: "condition",
  condition: { source: "input.amount", operator: "eq", branches: [], defaultNext: null },
});
const KNOWLEDGE_NODE = WorkflowNode.parse({
  id: "step_4",
  title: "查阅退货资料",
  type: "knowledge",
  knowledge: { space: "业务资料库", query: "退货规则" },
});

describe("NodeInspector", () => {
  it("修改节点名称时回调携带新值", () => {
    const onNodeChange = vi.fn();
    render(<NodeInspector node={AI_NODE} onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("节点名称"), { target: { value: "生成退款方案" } });
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: "step_1", title: "生成退款方案" }));
  });

  it("编辑说明时回调携带新的描述", () => {
    const onNodeChange = vi.fn();
    render(<NodeInspector node={AI_NODE} onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("说明"), { target: { value: "先核对订单再回复" } });
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({ description: "先核对订单再回复" }));
  });

  it("人工节点展示负责人与确认事项，修改后回调携带新值", () => {
    const onNodeChange = vi.fn();
    render(<NodeInspector node={HUMAN_NODE} onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);
    expect(screen.getByLabelText("负责人")).toHaveValue("客服主管");
    expect(screen.getByLabelText("确认事项")).toHaveValue("确认内容无误后再发送");
    fireEvent.change(screen.getByLabelText("负责人"), { target: { value: "合规专员" } });
    expect(onNodeChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ approval: { role: "合规专员", reason: "确认内容无误后再发送" } }),
    );
  });

  it("条件节点说明以判断说明呈现，便于看懂判断依据", () => {
    render(<NodeInspector node={CONDITION_NODE} onNodeChange={vi.fn()} onNodeDelete={vi.fn()} />);
    expect(screen.getByLabelText("判断说明")).toBeInTheDocument();
    expect(screen.queryByLabelText("说明")).not.toBeInTheDocument();
  });

  it("知识节点可以单独修改检索内容", () => {
    const onNodeChange = vi.fn();
    render(<NodeInspector node={KNOWLEDGE_NODE} onNodeChange={onNodeChange} onNodeDelete={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("检索内容"), { target: { value: "海蓝灯塔二四" } });
    expect(onNodeChange).toHaveBeenLastCalledWith(expect.objectContaining({
      knowledge: { space: "业务资料库", query: "海蓝灯塔二四" },
    }));
  });

  it("起点节点不提供删除，其余节点点击删除时回调携带节点标识", async () => {
    const onDeleteAi = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <NodeInspector node={AI_NODE} onNodeChange={vi.fn()} onNodeDelete={onDeleteAi} />,
    );
    await user.click(screen.getByRole("button", { name: "删除节点" }));
    expect(onDeleteAi).toHaveBeenCalledWith("step_1");

    const onStart = vi.fn();
    const startNode = WorkflowNode.parse({ id: "start", title: "收到业务任务", type: "trigger" });
    rerender(<NodeInspector node={startNode} onNodeChange={vi.fn()} onNodeDelete={onStart} />);
    expect(screen.queryByRole("button", { name: "删除节点" })).not.toBeInTheDocument();
  });
});
