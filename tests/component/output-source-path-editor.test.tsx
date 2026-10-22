import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { OutputSourcePathEditor } from "@/features/workflow-canvas/OutputSourcePathEditor";
import { WorkflowOutputEditor } from "@/features/workflow-canvas/WorkflowOutputEditor";
import type { OutputField } from "@/features/workflow-canvas/workflow-output-editing";
import { WORKFLOW_NODE_FOCUS_EVENT } from "@/lib/workflow-node-focus";
import { outputSourceWorkflow } from "../fixtures/output-source-workflow";

const base = outputSourceWorkflow().outputContract!.fields[0];
function Editor({ initial }: { initial: OutputField }) {
  const [field, setField] = useState(initial);
  return <OutputSourcePathEditor field={field} index={0} revisionKey={JSON.stringify(field)} onChange={(sourcePath) => setField({ ...field, sourcePath })} />;
}

describe("来源子字段逐层编辑", () => {
  it("保留原义的点和列表位置，添加空层级须修正后再增加", async () => {
    const user = userEvent.setup();
    render(<Editor initial={{ ...base, sourcePath: undefined }} />);
    await user.selectOptions(screen.getByLabelText("交付字段 1 取值方式"), "field");
    await waitFor(() => expect(screen.getByLabelText("交付字段 1 来源层级 1")).toHaveFocus());
    expect(screen.getByRole("button", { name: "添加来源层级" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("交付字段 1 来源层级 1"), { target: { value: "a.b" } });
    await user.click(screen.getByRole("button", { name: "添加来源层级" }));
    fireEvent.change(screen.getByLabelText("交付字段 1 来源层级 2"), { target: { value: "0" } });
    expect(screen.getByLabelText("交付字段 1 来源层级 1")).toHaveValue("a.b");
    expect(screen.getByLabelText("交付字段 1 来源层级 2")).toHaveValue("0");
  });
  it("清除取值范围必须确认，取消恢复原控件，最后一层删除改为整个结果", async () => {
    const user = userEvent.setup();
    render(<Editor initial={{ ...base, sourcePath: ["金额"] }} />);
    await user.selectOptions(screen.getByLabelText("交付字段 1 取值方式"), "whole");
    expect(screen.getByRole("dialog")).toHaveTextContent("改为整个步骤结果");
    expect(screen.getByLabelText("交付字段 1 来源层级 1")).toHaveValue("金额");
    await user.keyboard("{Escape}");
    expect(screen.getByLabelText("交付字段 1 取值方式")).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "删除交付字段 1 来源层级 1" }));
    await user.click(screen.getByRole("button", { name: "确认调整取值" }));
    expect(screen.queryByLabelText("交付字段 1 来源层级 1")).not.toBeInTheDocument();
    expect(screen.getByLabelText("交付字段 1 取值方式")).toHaveValue("whole");
  });
  it("过期确认拒绝修改，不删除新收到的来源层级", async () => {
    const onChange = vi.fn();
    const view = render(<OutputSourcePathEditor field={base} index={0} revisionKey="before" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "删除交付字段 1 来源层级 1" }));
    view.rerender(<OutputSourcePathEditor field={{ ...base, sourcePath: ["新值"] }} index={0} revisionKey="after" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "确认调整取值" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("已发生变化");
    expect(screen.getByLabelText("交付字段 1 来源层级 1")).toHaveValue("新值");
  });
  it("边界和保留层级用共享契约验证，读取旧定义不自动写入", () => {
    const onChange = vi.fn();
    const view = render(<OutputSourcePathEditor field={{ ...base, sourcePath: Array(32).fill("字段") }} index={0} revisionKey="max" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "添加来源层级" })).toBeDisabled();
    view.rerender(<OutputSourcePathEditor field={{ ...base, sourcePath: ["constructor"] }} index={0} revisionKey="reserved" onChange={onChange} />);
    expect(screen.getByRole("alert")).toHaveTextContent("保留名称");
    expect(screen.getByLabelText("交付字段 1 来源层级 1")).toHaveValue("constructor");
    expect(onChange).not.toHaveBeenCalled();
  });
  it("工作台显示实际来源上下文并定位所属组，切换来源保留层级", async () => {
    const draft = outputSourceWorkflow();
    const onChange = vi.fn();
    const focus = vi.fn();
    window.addEventListener(WORKFLOW_NODE_FOCUS_EVENT, focus);
    try {
      render(<WorkflowOutputEditor nodes={draft.nodes} fields={[base]} agentId="agent-test" onChange={onChange} />);
      await userEvent.click(screen.getByText(/^最终交付字段（/));
      expect(screen.getByRole("option", { name: "整理材料 / 登记材料" })).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "定位交付来源步骤" }));
      expect((focus.mock.calls[0][0] as CustomEvent).detail).toEqual({ agentId: "agent-test", nodeId: "group" });
      await userEvent.selectOptions(screen.getByLabelText("交付字段 1 来源"), "parallel.right.check");
      expect(onChange).toHaveBeenLastCalledWith([{ ...base, sourceNodeId: "parallel.right.check" }]);
      expect(screen.queryByText(/保存的是同一份完整/)).not.toBeInTheDocument();
    } finally { window.removeEventListener(WORKFLOW_NODE_FOCUS_EVENT, focus); }
  });
  it("不同子字段不误报相同结果，来源上下文和层级都可检索", async () => {
    const draft = outputSourceWorkflow();
    render(<WorkflowOutputEditor nodes={draft.nodes} fields={[base, { ...base, path: "交付.备注", sourcePath: ["备注"] }]} onChange={vi.fn()} />);
    await userEvent.click(screen.getByText(/^最终交付字段（/));
    expect(screen.queryByText(/来源和取值层级完全相同/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("查找交付定义"), { target: { value: "登记材料" } });
    expect(screen.getByText("匹配 2 项，显示 2 项。顺序操作调整完整定义，不仅是筛选结果。")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("查找交付定义"), { target: { value: "a.b" } });
    expect(screen.getByLabelText("交付字段 1 来源层级 1")).toBeInTheDocument();
    expect(screen.queryByLabelText("交付字段 2 来源层级 1")).not.toBeInTheDocument();
  });
});
