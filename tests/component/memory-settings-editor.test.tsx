import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import { MemorySettingsEditor } from "@/features/workflow-canvas/MemorySettingsEditor";

const sources = [{ id: "group.prepare", title: "准备材料" }];

describe("经验设置", () => {
  it("切换读写保留查询、条数、来源和导入的其他字段", () => {
    const onChange = vi.fn();
    function Editor() {
      const [value, setValue] = useState<unknown>({ mode: "read", query: "退款", limit: 2, contentFrom: "group.prepare", extra: { retained: true } });
      return <MemorySettingsEditor value={value} sources={sources} onChange={(next) => { onChange(next); setValue(next); }} />;
    }
    render(<Editor />);
    fireEvent.change(screen.getByLabelText("经验操作"), { target: { value: "write" } });
    expect(screen.getByLabelText("保存内容来源")).toHaveValue("group.prepare");
    fireEvent.change(screen.getByLabelText("经验操作"), { target: { value: "read" } });
    expect(screen.getByLabelText("查找内容")).toHaveValue("退款");
    expect(screen.getByLabelText("最多参考条数")).toHaveValue(2);
    expect(onChange).toHaveBeenLastCalledWith({ mode: "read", query: "退款", limit: 2, contentFrom: "group.prepare", extra: { retained: true } });
  });
  it.each([[0, 1], [2.8, 3], [99, 20]])("参考条数 %s 始终提交契约允许的整数 %s", (input, output) => {
    const onChange = vi.fn();
    render(<MemorySettingsEditor value={{ mode: "read", limit: 5 }} sources={[]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("最多参考条数"), { target: { value: String(input) } });
    expect(onChange).toHaveBeenLastCalledWith({ mode: "read", limit: output });
    expect(WorkflowNode.in.shape.memory.safeParse(onChange.mock.calls[0][0]).success).toBe(true);
  });
  it.each([undefined, { mode: "obsolete" }, { mode: "read", limit: 21 }, { mode: "write", contentFrom: 42 }])("不自动替换缺失或损坏配置：%j", (value) => {
    const onChange = vi.fn();
    render(<MemorySettingsEditor label="步骤组步骤 1" value={value} sources={[]} onChange={onChange} />);
    expect(screen.getByRole("status")).toHaveTextContent("尚未自动修改");
    expect(screen.getByLabelText("步骤组步骤 1 经验操作")).toHaveValue("");
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("步骤组步骤 1 经验操作"), { target: { value: "read" } });
    expect(onChange).toHaveBeenLastCalledWith({ mode: "read", query: "", limit: 5 });
  });
  it("来源换到后序或被删除时保留原值且提示运行失败边界", () => {
    const onChange = vi.fn();
    render(<MemorySettingsEditor value={{ mode: "write", contentFrom: "group.missing" }} sources={sources} onChange={onChange} />);
    expect(screen.getByLabelText("保存内容来源")).toHaveValue("group.missing");
    expect(screen.getByRole("status")).toHaveTextContent("来源没有结果时，这一步会停止并报错");
    expect(screen.queryByText("group.missing")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("保存内容来源"), { target: { value: "group.prepare" } });
    expect(onChange).toHaveBeenLastCalledWith({ mode: "write", contentFrom: "group.prepare" });
  });
  it("空来源使用已有汇总语义但不声称保存尚未完成结果", () => {
    const onChange = vi.fn();
    render(<MemorySettingsEditor value={{ mode: "write" }} sources={sources} onChange={onChange} />);
    expect(screen.getByRole("option", { name: "本次输入和此前已完成结果" })).toHaveValue("run_summary");
    expect(screen.getByText(/不能引用其他工作的组内结果/)).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
  });
});
