import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { MAX_WORKFLOW_OUTPUT_FIELDS, WorkflowNode } from "@/contracts/workflow";
import { WorkflowOutputEditor } from "@/features/workflow-canvas/WorkflowOutputEditor";
import type { OutputField } from "@/features/workflow-canvas/workflow-output-editing";
import { WORKFLOW_NODE_FOCUS_EVENT } from "@/lib/workflow-node-focus";

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
      { path: "交付内容_1", label: "生成方案", required: true, sourceNodeId: "draft" },
    ]);
    expect(screen.queryByRole("option", { name: "内部安全收口" })).not.toBeInTheDocument();
  });

  it("可以改结果字段位置、显示名称、必需状态并删除", async () => {
    const field = { path: "draft", label: "生成方案", required: true, sourceNodeId: "draft" };
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<WorkflowOutputEditor nodes={nodes} fields={[field]} onChange={onChange} />);
    await user.click(screen.getByText(/^最终交付字段（/));
    fireEvent.change(screen.getByLabelText("交付字段 1 位置"), { target: { value: "交付.方案" } });
    expect(onChange).toHaveBeenLastCalledWith([{ ...field, path: "交付.方案" }]);
    fireEvent.change(screen.getByLabelText("交付字段 1 显示名称"), { target: { value: "最终方案" } });
    expect(onChange).toHaveBeenLastCalledWith([{ ...field, label: "最终方案" }]);
    await user.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenLastCalledWith([{ ...field, required: false }]);
    await user.click(screen.getByRole("button", { name: "删除交付字段 1" }));
    expect(onChange).not.toHaveBeenLastCalledWith([]);
    await user.click(screen.getByRole("button", { name: "删除交付定义" }));
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

function Workbench({ initial }: { initial: OutputField[] }) {
  const [fields, setFields] = useState(initial);
  return <WorkflowOutputEditor nodes={nodes} fields={fields} agentId="agent-test" onChange={setFields} />;
}

describe("桌面交付定义工作台", () => {
  it("筛选保留完整编号和定义，空筛选可以恢复", async () => {
    const onChange = vi.fn();
    render(<WorkflowOutputEditor nodes={nodes} fields={[
      { path: "交付.方案", label: "方案", required: true, sourceNodeId: "draft" },
      { path: "交付.备注", label: "备注", required: false, sourceNodeId: "draft" },
    ]} onChange={onChange} />);
    await userEvent.click(screen.getByText(/^最终交付字段（/));
    await userEvent.selectOptions(screen.getByLabelText("交付定义范围"), "optional");
    expect(screen.getByLabelText("交付字段 2 位置")).toHaveValue("交付.备注");
    expect(screen.queryByLabelText("交付字段 1 位置")).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("查找交付定义"), "找不到的交付");
    expect(screen.getByText("没有匹配的交付定义，原定义没有删除。")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "查看全部交付定义" }));
    expect(screen.getByLabelText("交付字段 1 位置")).toHaveValue("交付.方案");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("展开与收起只限制显示数量，不删除其他定义", async () => {
    render(<Workbench initial={Array.from({ length: 10 }, (_, index) => ({ path: "交付_" + index, required: true, sourceNodeId: "draft" }))} />);
    await userEvent.click(screen.getByText(/^最终交付字段（/));
    expect(screen.queryByLabelText("交付字段 9 位置")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "展开全部 10 项交付定义" }));
    expect(screen.getByLabelText("交付字段 10 位置")).toHaveValue("交付_9");
    await userEvent.click(screen.getByRole("button", { name: "收起交付定义" }));
    expect(screen.queryByLabelText("交付字段 9 位置")).not.toBeInTheDocument();
  });

  it("筛选下换序移动整项定义而非仅显示项，焦点跟随名称", async () => {
    render(<Workbench initial={[
      { path: "首项", label: "第一项", required: true, sourceNodeId: "draft" },
      { path: "次项", label: "第二项", required: false, sourceNodeId: "draft" },
    ]} />);
    await userEvent.click(screen.getByText(/^最终交付字段（/));
    await userEvent.type(screen.getByLabelText("查找交付定义"), "第二项");
    await userEvent.click(screen.getByRole("button", { name: "上移交付字段 2" }));
    expect(screen.getByLabelText("交付字段 1 位置")).toHaveValue("次项");
    expect(screen.getByLabelText("交付字段 1 必需")).not.toBeChecked();
    await vi.waitFor(() => expect(screen.getByLabelText("交付字段 1 显示名称")).toHaveFocus());
    await userEvent.click(screen.getByRole("button", { name: "清除交付筛选" }));
    expect(screen.getByLabelText("交付字段 2 位置")).toHaveValue("首项");
    expect(screen.getByRole("button", { name: "上移交付字段 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下移交付字段 2" })).toBeDisabled();
  });

  it("未知与隐形来源不猜测替换，提示重复和上下级位置冲突", async () => {
    const onChange = vi.fn();
    render(<WorkflowOutputEditor nodes={nodes} fields={[
      { path: "结果", required: true, sourceNodeId: "missing" },
      { path: "结果.方案", label: "下级方案", required: true, sourceNodeId: "draft" },
      { path: "结果.方案", label: "重复方案", required: true, sourceNodeId: "draft" },
      { path: "保留", label: "未明确", required: true },
    ]} onChange={onChange} />);
    await userEvent.click(screen.getByText(/^最终交付字段（/));
    expect(screen.getByRole("option", { name: "原来源已不可用，请重新选择" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "内部安全收口" })).not.toBeInTheDocument();
    expect(screen.getByText(/请明确选择交付来源/)).toBeInTheDocument();
    expect(screen.getAllByText(/与其下级字段冲突/)).toHaveLength(2);
    expect(screen.getByLabelText("交付字段 4 来源")).toHaveValue("");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("来源定位用确切业务步骤，切换来源不改写字段位置", async () => {
    const second = WorkflowNode.parse({ id: "other", type: "system", title: "保存记录", next: null });
    const onChange = vi.fn();
    const focus = vi.fn();
    window.addEventListener(WORKFLOW_NODE_FOCUS_EVENT, focus);
    render(<WorkflowOutputEditor nodes={{ ...nodes, other: second }} fields={[{ path: "交付.方案", label: "方案", required: true, sourceNodeId: "draft" }]} agentId="agent-test" onChange={onChange} />);
    await userEvent.click(screen.getByText(/^最终交付字段（/));
    await userEvent.click(screen.getByRole("button", { name: "定位交付来源步骤" }));
    expect(focus.mock.calls[0][0].detail).toEqual({ agentId: "agent-test", nodeId: "draft" });
    await userEvent.selectOptions(screen.getByLabelText("交付字段 1 来源"), "other");
    expect(onChange).toHaveBeenCalledWith([{ path: "交付.方案", label: "方案", required: true, sourceNodeId: "other" }]);
    window.removeEventListener(WORKFLOW_NODE_FOCUS_EVENT, focus);
  });

  it("删除需要确认，取消返回焦点，删除最后一项说明真实结果行为", async () => {
    render(<Workbench initial={[{ path: "交付.方案", label: "方案", required: true, sourceNodeId: "draft" }]} />);
    await userEvent.click(screen.getByText(/^最终交付字段（/));
    await userEvent.click(screen.getByRole("button", { name: "删除交付字段 1" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("不会删除来源步骤");
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "删除交付字段 1" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "删除交付字段 1" }));
    await userEvent.click(screen.getByRole("button", { name: "删除交付定义" }));
    expect(screen.getByText(/现有执行会保留步骤结果清单/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加交付字段" })).toHaveFocus();
  });

  it("确认期间来源变化会拒绝旧删除", async () => {
    const fields = [{ path: "交付.方案", label: "方案", required: true, sourceNodeId: "draft" }];
    const onChange = vi.fn();
    const view = render(<WorkflowOutputEditor nodes={nodes} fields={fields} onChange={onChange} />);
    await userEvent.click(screen.getByText(/^最终交付字段（/));
    await userEvent.click(screen.getByRole("button", { name: "删除交付字段 1" }));
    view.rerender(<WorkflowOutputEditor nodes={{ ...nodes, draft: { ...nodes.draft, title: "更改后的方案" } }} fields={fields} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "删除交付定义" }));
    expect(screen.getByRole("alert")).toHaveTextContent("交付定义或来源已发生变化");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("没有业务来源时明确空状态，新增位置不会重复", async () => {
    const view = render(<WorkflowOutputEditor nodes={{ start: nodes.start, done: nodes.done }} fields={[]} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "添加交付字段" })).toBeDisabled();
    expect(screen.getByText(/当前没有可选择的业务步骤/)).toBeInTheDocument();
    view.unmount();
    render(<Workbench initial={[{ path: "交付内容_1", required: true, sourceNodeId: "draft" }]} />);
    await userEvent.click(screen.getByText(/^最终交付字段（/));
    await userEvent.click(screen.getByRole("button", { name: "添加交付字段" }));
    expect(screen.getByLabelText("交付字段 2 位置")).toHaveValue("交付内容_2");
    await vi.waitFor(() => expect(screen.getByLabelText("交付字段 2 显示名称")).toHaveFocus());
  });
});
