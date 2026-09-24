import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import { WorkflowOutputEditor } from "@/features/workflow-canvas/WorkflowOutputEditor";

const nodes = Object.fromEntries([
  WorkflowNode.parse({ id: "start", title: "收到任务", type: "trigger", next: "draft" }),
  WorkflowNode.parse({ id: "draft", title: "生成方案", type: "ai", next: "review" }),
  WorkflowNode.parse({ id: "review", title: "检查结果", type: "rule", next: "done", ui: { visibility: "control" } }),
  WorkflowNode.parse({ id: "done", title: "完成", type: "end", next: null }),
].map((node) => [node.id, node]));

describe("最终交付字段编辑", () => {
  it("只从业务步骤添加交付字段", async () => {
    const onChange = vi.fn();
    render(<WorkflowOutputEditor nodes={nodes} fields={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "添加交付字段" }));
    expect(onChange).toHaveBeenCalledWith([
      { path: "draft", label: "生成方案", required: true, sourceNodeId: "draft" },
    ]);
  });

  it("可以改显示名称、必需状态并删除", async () => {
    const field = { path: "draft", label: "生成方案", required: true, sourceNodeId: "draft" };
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<WorkflowOutputEditor nodes={nodes} fields={[field]} onChange={onChange} />);
    await user.click(screen.getByText(/最终交付字段/));
    fireEvent.change(screen.getByLabelText("交付字段 1 显示名称"), { target: { value: "最终方案" } });
    expect(onChange).toHaveBeenLastCalledWith([{ ...field, label: "最终方案" }]);
    await user.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenLastCalledWith([{ ...field, required: false }]);
    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});
