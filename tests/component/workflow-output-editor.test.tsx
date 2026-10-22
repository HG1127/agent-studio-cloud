import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MAX_WORKFLOW_OUTPUT_FIELDS, WorkflowNode } from "@/contracts/workflow";
import { WorkflowOutputEditor } from "@/features/workflow-canvas/WorkflowOutputEditor";

const nodes = Object.fromEntries([
  WorkflowNode.parse({ id: "start", title: "收到任务", type: "trigger", next: "draft" }),
  WorkflowNode.parse({ id: "draft", title: "生成方案", type: "ai", next: "review" }),
  WorkflowNode.parse({ id: "review", title: "检查结果", type: "rule", next: "done", ui: { visibility: "control" } }),
  WorkflowNode.parse({ id: "hidden", title: "内部安全收口", type: "system", next: "done", controlPlane: { kind: "safety", hiddenByDefault: true } }),
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
    expect(screen.queryByRole("option", { name: "内部安全收口" })).not.toBeInTheDocument();
  });

  it("可以改结果字段位置、显示名称、必需状态并删除", async () => {
    const field = { path: "draft", label: "生成方案", required: true, sourceNodeId: "draft" };
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<WorkflowOutputEditor nodes={nodes} fields={[field]} onChange={onChange} />);
    await user.click(screen.getByText(/最终交付字段/));
    fireEvent.change(screen.getByLabelText("交付字段 1 位置"), { target: { value: "交付.方案" } });
    expect(onChange).toHaveBeenLastCalledWith([{ ...field, path: "交付.方案" }]);
    fireEvent.change(screen.getByLabelText("交付字段 1 显示名称"), { target: { value: "最终方案" } });
    expect(onChange).toHaveBeenLastCalledWith([{ ...field, label: "最终方案" }]);
    await user.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenLastCalledWith([{ ...field, required: false }]);
    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("达到安全上限后不再添加交付字段", async () => {
    const fields = Array.from({ length: MAX_WORKFLOW_OUTPUT_FIELDS }, (_, index) => ({
      path: `result_${index}`, label: `结果 ${index}`, required: true, sourceNodeId: "draft",
    }));
    const onChange = vi.fn();
    render(<WorkflowOutputEditor nodes={nodes} fields={fields} onChange={onChange} />);
    expect(screen.getByText(`最终交付字段已达到 ${MAX_WORKFLOW_OUTPUT_FIELDS} 项上限。`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加交付字段" })).toBeDisabled();
  });
});
