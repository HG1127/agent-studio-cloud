import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { HandoffContract } from "@/contracts/workflow";
import { HandoffContractEditor } from "@/features/workflow-canvas/HandoffContractEditor";

const original = HandoffContract.parse({ deliverables: ["研究结果"], mustNotInclude: ["密钥", "私人草稿"],
  inputSchema: [{ name: "brief", label: "任务说明", type: "string" }],
  outputSchema: [{ name: "result.answer", label: "研究结论", type: "object", required: false }],
  memoryPolicy: { mode: "none", shared: ["业务状态"], private: ["私人草稿"] },
});

function Controlled({ onChange, value = original }: { onChange: (value: HandoffContract) => void; value?: HandoffContract }) {
  const [contract, setContract] = useState(value);
  return <HandoffContractEditor value={contract} onChange={(next) => { setContract(next); onChange(next); }} />;
}

describe("交接约定编辑", () => {
  it.each([
    ["必须交付", "deliverables"],
    ["禁止传递", "mustNotInclude"],
    ["不得传递的字段名称", "private"],
  ] as const)("%s 可用回车逐行输入，保存值仍按行整理", async (label, field) => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onChange={onChange} />);
    const input = screen.getByLabelText(label);
    const previous = field === "private" ? original.memoryPolicy!.private : original[field];
    await user.click(input);
    await user.keyboard("{End}{Enter}复核清单");
    expect(input).toHaveValue(`${previous.join("\n")}\n复核清单`);
    const changed = onChange.mock.lastCall![0] as HandoffContract;
    expect(field === "private" ? changed.memoryPolicy!.private : changed[field]).toEqual([...previous, "复核清单"]);
  });

  it("外部草稿恢复后多行输入随之更新，不保留另一份旧编辑值", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<HandoffContractEditor value={original} onChange={onChange} />);
    await user.click(screen.getByLabelText("必须交付"));
    await user.keyboard("{End}{Enter}");
    rerender(<HandoffContractEditor value={{ ...original, deliverables: ["恢复后的交付"] }} onChange={onChange} />);
    expect(screen.getByLabelText("必须交付")).toHaveValue("恢复后的交付");
  });

  it("展示真实冻结字段和执行边界，不自动改写或把共享名称冒称白名单", () => {
    const onChange = vi.fn();
    render(<HandoffContractEditor value={original} onChange={onChange} />);
    expect(screen.getByLabelText("必须交付")).toHaveValue("研究结果");
    expect(screen.getByLabelText("禁止传递")).toHaveValue("密钥\n私人草稿");
    expect(screen.getByLabelText("传入字段 1 位置")).toHaveValue("brief");
    expect(screen.getByLabelText("返回字段 1 格式")).toHaveValue("object");
    expect(screen.getByLabelText("返回字段 1 必须提供")).not.toBeChecked();
    expect(screen.getByText(/当前执行不会按这些名称单独筛选经验/)).toBeVisible();
    expect(screen.getByText(/不会自动补出缺失数据或建立输入映射/)).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("编辑名称、格式和必填标记，只改选定字段并保留其他约定", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onChange={onChange} />);
    await user.click(screen.getByText("传入字段约定 · 1 项"));
    fireEvent.change(screen.getByLabelText("传入字段 1 名称"), { target: { value: "交接说明" } });
    await user.selectOptions(screen.getByLabelText("传入字段 1 格式"), "object");
    await user.click(screen.getByLabelText("传入字段 1 必须提供"));
    expect(onChange).toHaveBeenLastCalledWith({ ...original, inputSchema: [{ name: "brief", label: "交接说明", type: "object", required: false }] });
    expect(original.inputSchema[0].label).toBe("任务说明");
  });

  it("增删字段时生成不冲突的位置并保留返回约定和经验边界", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const value = HandoffContract.parse({ ...original, inputSchema: [{ name: "field_1" }, { name: "field_3" }] });
    render(<Controlled value={value} onChange={onChange} />);
    await user.click(screen.getByText("传入字段约定 · 2 项"));
    await user.click(screen.getByRole("button", { name: "添加传入字段" }));
    expect(screen.getByLabelText("传入字段 3 位置")).toHaveValue("field_2");
    await user.click(screen.getByRole("button", { name: "移除传入字段 2" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ inputSchema: [{ name: "field_1", type: "any", required: true }, { name: "field_2", label: "新增字段", type: "string", required: true }], outputSchema: original.outputSchema, memoryPolicy: original.memoryPolicy }));
  });

  it("扩大经验范围须确认，取消不改草稿，确认保留禁止字段和旧共享名称", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onChange={onChange} />);
    await user.selectOptions(screen.getByLabelText("经验传递范围"), "team");
    expect(screen.getByRole("dialog")).toHaveTextContent("当前不会按共享名称单独筛选");
    expect(screen.getByLabelText("经验传递范围")).toHaveValue("none");
    await user.click(screen.getByRole("button", { name: "返回" }));
    expect(onChange).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText("经验传递范围"), "team");
    await user.click(screen.getByRole("button", { name: "确认允许传递" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...original, memoryPolicy: { ...original.memoryPolicy, mode: "team" } });
    expect(screen.getByLabelText("经验传递范围")).toHaveValue("team");
    await user.selectOptions(screen.getByLabelText("经验传递范围"), "none");
    expect(onChange).toHaveBeenLastCalledWith(original);
  });

  it("禁止字段按行整理，同时保留已选经验范围", () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("不得传递的字段名称"), { target: { value: "  私人草稿\n\n联系电话 " } });
    expect(onChange).toHaveBeenLastCalledWith({ ...original, memoryPolicy: { ...original.memoryPolicy, private: ["私人草稿", "联系电话"] } });
  });

  it("缺失约定有明确空状态，不自动生成可用设置", () => {
    const onChange = vi.fn();
    render(<HandoffContractEditor onChange={onChange} />);
    expect(screen.getByLabelText("经验传递范围")).toHaveValue("");
    expect(screen.getByText(/还没有设置经验传递范围/)).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("非法位置立即提示，仍由共享契约和真实保存动作校验", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onChange={onChange} />);
    await user.click(screen.getByText("传入字段约定 · 1 项"));
    fireEvent.change(screen.getByLabelText("传入字段 1 位置"), { target: { value: "constructor.secret" } });
    expect(screen.getByRole("alert")).toHaveTextContent("不能使用保留名称");
    expect(HandoffContract.safeParse(onChange.mock.lastCall?.[0]).success).toBe(false);
  });

  it("旧经验设置保留但不声称控制目标助手自身的经验", () => {
    const onChange = vi.fn();
    render(<HandoffContractEditor value={{ ...original, memoryPolicy: { ...original.memoryPolicy!, mode: "self" } }} onChange={onChange} />);
    expect(screen.getByLabelText("经验传递范围")).toHaveValue("self");
    expect(screen.getByRole("option", { name: "不传递上游经验（保留原设置）" })).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
