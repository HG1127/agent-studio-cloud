import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { MAX_WORKFLOW_VARIABLES, WorkflowNode, type WorkflowVariable } from "@/contracts/workflow";
import { WORKFLOW_NODE_FOCUS_EVENT, type WorkflowNodeFocusDetail } from "@/lib/workflow-node-focus";
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
    const beforeDelete = onChange.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "删除输入字段 1" }));
    expect(onChange).toHaveBeenCalledTimes(beforeDelete);
    await user.click(screen.getByRole("button", { name: "删除输入定义" }));
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

  it("业务说明保存到原定义，类型切换不丢失范围、说明和原扩展字段", () => {
    const variable = { name: "brief", label: "材料", type: "string", scope: "run", required: false, description: "原说明", legacyMeta: { note: "保留原记录" } };
    const onChange = vi.fn();
    render(<WorkflowInputEditor variables={[variable]} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("字段 1 业务说明"), { target: { value: "核对业务需求" } });
    expect(onChange).toHaveBeenLastCalledWith([{ ...variable, description: "核对业务需求" }]);
    fireEvent.change(screen.getByLabelText("字段 1 类型"), { target: { value: "object" } });
    expect(onChange).toHaveBeenLastCalledWith([{ ...variable, type: "object" }]);
    expect(screen.getByText("本次运行字段的说明随草稿保存，发布后作为该版本表单的填写提示；不会自动进入模型提示。")).toBeInTheDocument();
  });

  it("原未知类型被如实保留，选择前不冒充文字输入", async () => {
    const onChange = vi.fn();
    const variable = { name: "amount", type: "any", scope: "run", required: true };
    render(<WorkflowInputEditor variables={[variable]} onChange={onChange} />);
    await userEvent.click(screen.getByText(/运行输入字段/));
    expect(screen.getByLabelText("字段 1 类型")).toHaveValue("any");
    expect(screen.getByRole("option", { name: "原类型未明确或不受支持" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("选择前不会自动改写原类型");
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.selectOptions(screen.getByLabelText("字段 1 类型"), "number");
    expect(onChange).toHaveBeenCalledWith([{ ...variable, type: "number" }]);
  });

  it("其他范围只读且不声称私有或共享已经实现，明确确认后才转为运行输入", async () => {
    const variable = { name: "private_note", label: "原记录", type: "string", scope: "private", required: false, description: "保留说明" };
    const onChange = vi.fn();
    render(<WorkflowInputEditor variables={[variable]} onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByText(/运行输入字段/));
    expect(screen.getByText("原私有定义，未接入")).toBeVisible();
    expect(screen.getByLabelText("字段 1 名称")).toBeDisabled();
    expect(screen.getByLabelText("字段 1 业务说明")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "设为本次运行输入字段 1" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("不建立团队共享、私有权限或默认值");
    await user.click(screen.getByRole("button", { name: "返回" }));
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "设为本次运行输入字段 1" }));
    await user.click(screen.getByRole("button", { name: "设为本次运行输入" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith([{ ...variable, scope: "run" }]);
  });

  it("定义变化后拒绝过期删除确认，不覆盖其他字段", async () => {
    const variable = { name: "brief", type: "string", scope: "run", required: true };
    const onChange = vi.fn();
    const { rerender } = render(<WorkflowInputEditor variables={[variable]} onChange={onChange} />);
    await userEvent.click(screen.getByText(/运行输入字段/));
    await userEvent.click(screen.getByRole("button", { name: "删除输入字段 1" }));
    rerender(<WorkflowInputEditor variables={[{ ...variable, label: "已更新名称" }]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "删除输入定义" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("输入定义已发生变化");
    await userEvent.click(screen.getByRole("button", { name: "删除输入字段 1" }));
    await userEvent.click(screen.getByRole("button", { name: "删除输入定义" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith([]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("取消删除支持键盘返回且不修改定义", async () => {
    const onChange = vi.fn();
    render(<WorkflowInputEditor variables={[{ name: "brief", type: "string", scope: "run", required: true }]} onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByText(/运行输入字段/));
    const trigger = screen.getByRole("button", { name: "删除输入字段 1" });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("在完整定义中换序并聚焦被移动字段，删除后聚焦添加入口", async () => {
    const first = { name: "first", label: "先核对", type: "string", scope: "run", required: true };
    const second = { name: "second", label: "后核对", type: "number", scope: "run", required: false, description: "原业务说明" };
    function Harness() {
      const [variables, setVariables] = useState<WorkflowVariable[]>([first, second]);
      return <WorkflowInputEditor variables={variables} onChange={setVariables} />;
    }
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByText(/运行输入字段/));
    await user.click(screen.getByRole("button", { name: "上移输入字段 2" }));
    expect(screen.getByLabelText("字段 1 名称")).toHaveValue("second");
    expect(screen.getByLabelText("字段 1 业务说明")).toHaveValue("原业务说明");
    await waitFor(() => expect(screen.getByLabelText("字段 1 显示名称")).toHaveFocus());
    expect(screen.getByRole("button", { name: "上移输入字段 1" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "删除输入字段 1" }));
    await user.click(screen.getByRole("button", { name: "删除输入定义" }));
    expect(screen.getByLabelText("字段 1 名称")).toHaveValue("first");
    await waitFor(() => expect(screen.getByRole("button", { name: "添加输入字段" })).toHaveFocus());
  });

  it("组合筛选不改变完整概览，空筛选可恢复且不冒充没有定义", async () => {
    const onChange = vi.fn();
    render(<WorkflowInputEditor variables={[
      { name: "brief", label: "材料核对", type: "string", scope: "run", required: true },
      { name: "legacy", label: "旧记录", type: "string", scope: "private", required: false },
    ]} onChange={onChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByText(/运行输入字段/));
    await user.selectOptions(screen.getByLabelText("输入定义范围"), "legacy");
    await user.type(screen.getByLabelText("查找输入定义"), "旧记录");
    expect(within(screen.getByRole("list", { name: "输入定义列表" })).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByLabelText("输入定义概览")).toHaveTextContent("本次运行定义1其他范围原定义1需核对字段0");
    await user.clear(screen.getByLabelText("查找输入定义"));
    await user.type(screen.getByLabelText("查找输入定义"), "不存在");
    expect(screen.getByText(/没有匹配的输入定义/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "查看全部输入定义" }));
    expect(within(screen.getByRole("list", { name: "输入定义列表" })).getAllByRole("listitem")).toHaveLength(2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("只能定位真实主流程引用，删除提示仍可能推导同名输入", async () => {
    const nodes = { decision: WorkflowNode.parse({ id: "decision", title: "核对材料", type: "condition", condition: { source: "input.brief", branches: [{ label: "符合", value: "yes", next: null }] } }) };
    const onChange = vi.fn();
    const events: WorkflowNodeFocusDetail[] = [];
    const receive = (event: Event) => events.push((event as CustomEvent<WorkflowNodeFocusDetail>).detail);
    window.addEventListener(WORKFLOW_NODE_FOCUS_EVENT, receive);
    try {
      render(<WorkflowInputEditor agentId="agent" nodes={nodes} variables={[{ name: "brief", type: "string", scope: "run", required: true }]} onChange={onChange} />);
      await userEvent.click(screen.getByText(/运行输入字段/));
      await userEvent.click(screen.getByRole("button", { name: "查看关联流程步骤" }));
      expect(events).toEqual([{ agentId: "agent", nodeId: "decision" }]);
      await userEvent.click(screen.getByRole("button", { name: "删除输入字段 1" }));
      expect(screen.getByRole("dialog")).toHaveTextContent("1 个关联步骤");
      expect(screen.getByRole("dialog")).toHaveTextContent("发布仍可能推导出同名输入");
      await userEvent.click(screen.getByRole("button", { name: "删除输入定义" }));
      expect(onChange).toHaveBeenCalledWith([]);
      expect(nodes.decision.condition!.source).toBe("input.brief");
    } finally { window.removeEventListener(WORKFLOW_NODE_FOCUS_EVENT, receive); }
  });

  it("只展开首批定义，添加时避开已存在字段名", async () => {
    const onChange = vi.fn();
    const variables = Array.from({ length: 10 }, (_, index) => ({ name: index === 0 ? "field_11" : `field_${index}`, label: `显示 ${index + 1}`, type: "string", scope: "run", required: true }));
    render(<WorkflowInputEditor variables={variables} onChange={onChange} />);
    await userEvent.click(screen.getByText(/运行输入字段/));
    expect(screen.queryByLabelText("字段 10 名称")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "展开其他 2 项输入定义" }));
    expect(screen.getByLabelText("字段 10 名称")).toHaveValue("field_9");
    await userEvent.click(screen.getByRole("button", { name: "添加输入字段" }));
    expect(onChange.mock.calls.at(-1)![0].at(-1)).toMatchObject({ name: "field_12", scope: "run" });
  });
});
