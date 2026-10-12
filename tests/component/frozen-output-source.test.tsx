import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FrozenWorkflowViewer } from "@/features/versions/FrozenWorkflowViewer";
import { frozenWorkflowView } from "@/features/versions/frozen-workflow-view";
import { outputSourceWorkflow } from "../fixtures/output-source-workflow";

const flow = vi.hoisted(() => ({ props: null as Record<string, unknown> | null, setCenter: vi.fn() }));
vi.mock("@xyflow/react", () => ({ ReactFlow: (props: Record<string, unknown>) => { flow.props = props; (props.onInit as (instance: unknown) => void)(flow); return <div />; }, Background: () => null, Handle: () => null, Position: { Left: "left", Right: "right" } }));

describe("冻结版本真实来源子字段", () => {
  it("合法组内来源显示实际业务上下文和冻结字面层级，定位所属步骤并聚焦", async () => {
    const workflow = frozenWorkflowView(outputSourceWorkflow());
    const original = JSON.stringify(workflow);
    render(<FrozenWorkflowViewer workflow={workflow} input={{ fields: [] }} output={workflow.outputContract} />);
    const outputs = screen.getByRole("region", { name: "冻结的最终交付约定" });
    expect(outputs).not.toHaveTextContent("未找到对应步骤");
    expect(outputs).not.toHaveTextContent("group.child.with.dot");
    const layers = within(outputs).getByRole("list", { name: "交付 1 冻结来源层级" });
    expect(within(layers).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["第 1 层：a.b", "第 2 层：0", "第 3 层：金额"]);
    await userEvent.click(within(outputs).getByRole("button", { name: "定位来源：整理材料 / 登记材料" }));
    expect(screen.getByRole("heading", { name: /^整理材料$/ })).toHaveFocus();
    expect(flow.setCenter).toHaveBeenCalled();
    await userEvent.click(within(outputs).getByRole("button", { name: "定位来源：分别核对 / 业务核对 / 记录确认" }));
    expect(screen.getByRole("heading", { name: /^分别核对$/ })).toHaveFocus();
    expect(JSON.stringify(workflow)).toBe(original);
    expect(flow.props).toMatchObject({ nodesDraggable: false, nodesConnectable: false, edgesReconnectable: false, deleteKeyCode: null });
    expect(flow.props?.onConnect).toBeUndefined();
    expect(flow.props?.onNodesChange).toBeUndefined();
  });
  it("冻结输出来源以实际 manifest 参数为准，不拿流程中的另一份字段或当前草稿补造", () => {
    const workflow = frozenWorkflowView(outputSourceWorkflow());
    const frozen = { ...workflow.outputContract!.fields[0], label: "已冻结的金额", sourcePath: ["原字段.含点"] };
    render(<FrozenWorkflowViewer workflow={workflow} input={{ fields: [] }} output={{ fields: [frozen] }} />);
    const outputs = screen.getByRole("region", { name: "冻结的最终交付约定" });
    expect(outputs).toHaveTextContent("已冻结的金额");
    expect(outputs).toHaveTextContent("第 1 层：原字段.含点");
    expect(within(outputs).getAllByRole("listitem")).toHaveLength(2);
    expect(outputs).not.toHaveTextContent("第 2 层：0");
    expect(workflow.outputContract!.fields[0].sourcePath).toEqual(["a.b", "0", "金额"]);
  });
  it("旧缺省和明确空路径保持整步，缺失来源不按标识前缀定位", () => {
    const workflow = frozenWorkflowView(outputSourceWorkflow());
    const field = workflow.outputContract!.fields[0];
    render(<FrozenWorkflowViewer workflow={workflow} input={{ fields: [] }} output={{ fields: [
      { ...field, path: "交付.整步", sourcePath: undefined },
      { ...field, path: "交付.空路径", sourcePath: [] },
      { ...field, path: "交付.未知", sourceNodeId: "group.unknown" },
    ] }} />);
    const outputs = screen.getByRole("region", { name: "冻结的最终交付约定" });
    expect(within(outputs).getAllByText("取值：整个步骤结果。不从交付位置推测子字段。")).toHaveLength(2);
    expect(within(outputs).getByText("已保存来源关联，但未找到对应步骤。")).toBeInTheDocument();
    expect(within(outputs).getAllByRole("button")).toHaveLength(2);
  });
  it("隐藏组或非法内嵌组不伪造可定位来源，保留原约定", () => {
    const draft = outputSourceWorkflow();
    draft.nodes.group.ui = { visibility: "control" };
    draft.nodes.parallel.parallel!.branches = draft.nodes.parallel.parallel!.branches.slice(0, 1);
    const workflow = frozenWorkflowView(draft);
    const original = JSON.stringify(workflow.outputContract);
    render(<FrozenWorkflowViewer workflow={workflow} input={{ fields: [] }} output={workflow.outputContract} />);
    const outputs = screen.getByRole("region", { name: "冻结的最终交付约定" });
    expect(within(outputs).queryByRole("button")).not.toBeInTheDocument();
    expect(within(outputs).getAllByText("已保存来源关联，但未找到对应步骤。")).toHaveLength(2);
    expect(JSON.stringify(workflow.outputContract)).toBe(original);
  });
  it("非法或凭据来源层级不声称可采用，不改写字段", () => {
    const workflow = frozenWorkflowView(outputSourceWorkflow());
    const field = workflow.outputContract!.fields[0];
    render(<FrozenWorkflowViewer workflow={workflow} input={{ fields: [] }} output={{ fields: [
      { ...field, sourcePath: ["constructor"] },
      { ...field, path: "交付.凭据", sourcePath: ["password"] },
    ] }} />);
    const outputs = screen.getByRole("region", { name: "冻结的最终交付约定" });
    expect(within(outputs).getAllByText(/保存的来源取值约定无法按当前规则核对/)).toHaveLength(2);
    expect(outputs).not.toHaveTextContent("第 1 层：constructor");
    expect(outputs).not.toHaveTextContent("第 1 层：password");
  });
});
