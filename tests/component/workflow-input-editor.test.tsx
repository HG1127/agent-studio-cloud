import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MAX_WORKFLOW_VARIABLES } from "@/contracts/workflow";
import { WorkflowInputEditor } from "@/features/workflow-canvas/WorkflowInputEditor";

describe("运行输入字段编辑", () => {
  it("可以添加默认字段", async () => {
    const onChange = vi.fn();
    render(<WorkflowInputEditor variables={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "添加输入字段" }));
    expect(onChange).toHaveBeenCalledWith([
      { name: "field_1", label: "新输入字段", type: "string", scope: "run", required: true },
    ]);
  });

  it("可以修改名称、类型、必填状态并删除", async () => {
    const variable = { name: "brief", label: "任务说明", type: "string", scope: "run", required: true };
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<WorkflowInputEditor variables={[variable]} onChange={onChange} />);
    await user.click(screen.getByText(/运行输入字段/));
    fireEvent.change(screen.getByLabelText("字段 1 名称"), { target: { value: "order-id" } });
    expect(onChange).toHaveBeenLastCalledWith([{ ...variable, name: "orderid" }]);
    fireEvent.change(screen.getByLabelText("字段 1 名称"), { target: { value: "1order" } });
    expect(onChange).toHaveBeenLastCalledWith([{ ...variable, name: "_1order" }]);

    rerender(<WorkflowInputEditor variables={[variable]} onChange={onChange} />);
    await user.selectOptions(screen.getByLabelText("字段 1 类型"), "number");
    expect(onChange).toHaveBeenLastCalledWith([{ ...variable, type: "number" }]);
    await user.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenLastCalledWith([{ ...variable, required: false }]);
    await user.click(screen.getByRole("button", { name: "删除" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("达到字段上限后停止添加并明确提示", async () => {
    const onChange = vi.fn();
    const variables = Array.from({ length: MAX_WORKFLOW_VARIABLES }, (_, index) => ({
      name: `field_${index + 1}`,
      label: `字段 ${index + 1}`,
      type: "string",
      scope: "run",
      required: true,
    }));
    render(<WorkflowInputEditor variables={variables} onChange={onChange} />);
    const add = screen.getByRole("button", { name: "添加输入字段" });
    expect(add).toBeDisabled();
    expect(screen.getByText(`运行输入字段已达到 ${MAX_WORKFLOW_VARIABLES} 项上限。`)).toBeInTheDocument();
    await userEvent.click(add);
    expect(onChange).not.toHaveBeenCalled();
  });
});
