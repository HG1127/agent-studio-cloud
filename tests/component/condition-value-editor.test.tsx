import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConditionValueEditor } from "@/features/workflow-canvas/ConditionValueEditor";

const label = "情况 1 比较值";
function StatefulEditor({ initial, onChange = vi.fn() }: { initial: unknown; onChange?: (value: unknown) => void }) {
  const [value, setValue] = useState(initial);
  return <ConditionValueEditor label={label} value={value} operator="eq" onChange={(next) => { onChange(next); setValue(next); }} />;
}

describe("条件比较值的明确类型", () => {
  it.each(["false", "true", "0", "null", "0012", "", '{"flag":false}'])("文字 %j 不自动猜测类型", (text) => {
    const change = vi.fn();
    render(<StatefulEditor initial="原文字" onChange={change} />);
    fireEvent.change(screen.getByLabelText(label), { target: { value: text } });
    expect(change).toHaveBeenLastCalledWith(text);
    expect(screen.getByLabelText(label + "类型")).toHaveValue("string");
  });

  it("类型转换是显式操作，零和否分别保存", async () => {
    const change = vi.fn();
    const user = userEvent.setup();
    render(<StatefulEditor initial="false" onChange={change} />);
    await user.selectOptions(screen.getByLabelText(label + "类型"), "boolean");
    expect(change).toHaveBeenLastCalledWith(false);
    expect(screen.getByLabelText(label)).toHaveValue("false");
    await user.selectOptions(screen.getByLabelText(label), "true");
    expect(change).toHaveBeenLastCalledWith(true);
    await user.selectOptions(screen.getByLabelText(label + "类型"), "number");
    expect(change).toHaveBeenLastCalledWith(0);
    await user.selectOptions(screen.getByLabelText(label + "类型"), "null");
    expect(change).toHaveBeenLastCalledWith(null);
    expect(screen.getByText("比较值为空值，不是空文字。")).toBeVisible();
  });

  it("允许分步输入负数、小数和指数，不提交中间的无效值", () => {
    const change = vi.fn();
    render(<StatefulEditor initial={0} onChange={change} />);
    const input = screen.getByLabelText(label);
    for (const [text, expected] of [["-", null], ["-1", -1], ["-1.", null], ["-1.0", -1], ["-1.05", -1.05], ["1e", null], ["1e2", 100]] as const) {
      change.mockClear();
      fireEvent.change(input, { target: { value: text } });
      expect(input).toHaveValue(text);
      if (expected === null) expect(change).not.toHaveBeenCalled();
      else expect(change).toHaveBeenCalledWith(expected);
    }
  });

  it.each(["", "Infinity", "NaN", "1e309", "abc"])("无效数字 %j 不污染草稿，离开后恢复已保存数字", (text) => {
    const change = vi.fn();
    render(<StatefulEditor initial={42} onChange={change} />);
    const input = screen.getByLabelText(label);
    fireEvent.change(input, { target: { value: text } });
    expect(change).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("草稿仍使用上一次有效数字");
    fireEvent.blur(input);
    expect(input).toHaveValue("42");
  });

  it("导入对象、列表和未设置值不自动替换", () => {
    const change = vi.fn();
    const object = { flag: false, count: 0 };
    const { rerender } = render(<ConditionValueEditor label={label} value={object} operator="eq" onChange={change} />);
    expect(screen.getByLabelText(label + "类型")).toHaveValue("structured");
    expect(screen.getByText((_, element) => element?.tagName === "PRE" && element.textContent === JSON.stringify(object, null, 2))).toBeInTheDocument();
    rerender(<ConditionValueEditor label={label} value={[]} operator="eq" onChange={change} />);
    expect(screen.getByText("[]")).toBeInTheDocument();
    rerender(<ConditionValueEditor label={label} value={undefined} operator="eq" onChange={change} />);
    expect(screen.getByLabelText(label + "类型")).toHaveValue("unset");
    expect(change).not.toHaveBeenCalled();
  });

  it.each(["truthy", "exists"])("%s 隐藏未参与判断的值，不写入替代值", (operator) => {
    const change = vi.fn();
    render(<ConditionValueEditor label={label} value={false} operator={operator} onChange={change} />);
    expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    expect(screen.getByText("此判断不使用比较值，原有比较值会保留。")).toBeVisible();
    expect(change).not.toHaveBeenCalled();
  });
});
