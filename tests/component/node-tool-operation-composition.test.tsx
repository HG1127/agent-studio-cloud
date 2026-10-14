import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlowCanvas } from "@/features/workflow-canvas/FlowCanvas";
import { NodeInspector } from "@/features/workflow-canvas/NodeInspector";
import { saveWorkflowAction } from "@/server/actions/save-workflow";
import { configuredToolOperationWorkflow, nodeToolOperationTestOption, nodeToolOperationWorkflow } from "../fixtures/node-tool-operation-workflow";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/server/actions/save-workflow", () => ({ saveWorkflowAction: vi.fn() }));
vi.mock("@xyflow/react", () => ({ ReactFlow: () => <div aria-label="测试画布" />, Background: () => null, Controls: () => null }));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(saveWorkflowAction).mockReset(); window.sessionStorage.clear(); vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function canvas(configured = false) {
  const tool = nodeToolOperationTestOption(), workflow = configured ? configuredToolOperationWorkflow().workflow : nodeToolOperationWorkflow(tool);
  const props = { agentId: workflow.rootAgent.id, draft: workflow, draftUpdatedAt: "2026-10-09T00:00:00.000Z", agentTargets: [], toolOptions: [tool], knowledgeSources: [] };
  return { ...render(<FlowCanvas {...props} />), props, workflow, tool };
}
async function panel(id = "top", label = "当前步骤") {
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "定位流程步骤" }), id);
  const summary = screen.getByLabelText(label + "输入与结果约定");
  if (!(summary.closest("details") as HTMLDetailsElement).open) await userEvent.click(summary);
  return within(await screen.findByRole("region", { name: label + "字段约定" }));
}
function fixed(editor: ReturnType<typeof within>, value = "0") {
  fireEvent.click(editor.getByRole("checkbox", { name: "设置业务操作防重" }));
  fireEvent.change(editor.getByLabelText("防重范围"), { target: { value: "registered" } });
  fireEvent.change(editor.getByLabelText("业务标识来源"), { target: { value: "literal" } });
  fireEvent.change(editor.getByLabelText("固定值类型"), { target: { value: "number" } });
  fireEvent.change(editor.getByLabelText("固定业务标识"), { target: { value } });
}
async function save() {
  vi.mocked(saveWorkflowAction).mockResolvedValue({ ok: true, updatedAt: "2026-10-09T00:00:01.000Z" });
  await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));
  await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled());
  return vi.mocked(saveWorkflowAction).mock.calls[0][1];
}

describe("真实画布工具防重父接线", () => {
  it("主流程显式应用后才能保存，撤销重做沿原动作且不会执行工具", async () => {
    const { workflow, tool } = canvas(); const editor = await panel(); fixed(editor);
    expect(screen.getByLabelText("未应用配置提醒")).toHaveTextContent("1 处");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    expect(saveWorkflowAction).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(editor.getByRole("button", { name: "应用到当前草稿" }));
    expect(screen.queryByLabelText("未应用配置提醒")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "撤销上一步修改" }));
    expect(editor.getByRole("checkbox", { name: "设置业务操作防重" })).not.toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "重做上一步修改" }));
    expect(editor.getByRole("checkbox", { name: "设置业务操作防重" })).toBeChecked();
    const saved = await save();
    expect(saved).toEqual({ ...workflow, nodes: { ...workflow.nodes, top: { ...workflow.nodes.top, toolOperation: { scope: tool.scope, key: { kind: "literal", value: 0 } } } } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("防重填写跨选择与关闭保留，不持久保存或提交", async () => {
    canvas(); let editor = await panel(); const storage = vi.spyOn(Storage.prototype, "setItem"); fixed(editor, "12");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "定位流程步骤" }), "prepare");
    editor = await panel(); expect(editor.getByLabelText("固定业务标识")).toHaveValue("12");
    await userEvent.click(screen.getAllByRole("button", { name: "关闭节点详情" })[0]);
    editor = await panel(); expect(editor.getByLabelText("固定业务标识")).toHaveValue("12");
    expect(screen.getByLabelText("未应用配置提醒")).toHaveTextContent("1 处");
    expect(storage).not.toHaveBeenCalled(); expect(saveWorkflowAction).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    ["group", "步骤组步骤 2", undefined], ["parallel", "并行工作 1 步骤 1", "left"], ["parallel", "并行工作 2 步骤 1", "right"],
  ] as const)("组内保存只回写原步骤防重而不写运行标识：%s %s", async (id, label, branchId) => {
    const { workflow, tool } = canvas(), editor = await panel(id, label); fixed(editor);
    fireEvent.click(editor.getByRole("button", { name: "应用到当前草稿" }));
    expect(editor.getByText("防重规则已应用到当前页面草稿，尚未保存或发布。")).toBeInTheDocument();
    const saved = await save(), config = { scope: tool.scope, key: { kind: "literal", value: 0 } };
    const expected = id === "group" ? { ...workflow.nodes.group, subflow: { ...workflow.nodes.group.subflow!, steps: workflow.nodes.group.subflow!.steps.map((step, index) => index === 1 ? { ...step, toolOperation: config } : step) } }
      : { ...workflow.nodes.parallel, parallel: { ...workflow.nodes.parallel.parallel!, branches: workflow.nodes.parallel.parallel!.branches.map((branch) => branch.id === branchId ? { ...branch, steps: branch.steps.map((step) => ({ ...step, toolOperation: config })) } : branch) } };
    expect(saved).toEqual({ ...workflow, nodes: { ...workflow.nodes, [id]: expected } }); expect(fetch).not.toHaveBeenCalled();
  });
  it("仅清除已接受的防重填写，输入映射填写仍保留且不会被保存", async () => {
    const { workflow, tool } = canvas(), editor = await panel(); fixed(editor);
    fireEvent.click(editor.getByRole("button", { name: "开始配置输入映射" })); fireEvent.click(editor.getByRole("button", { name: "添加字段映射" }));
    const row = within(editor.getByRole("group", { name: "字段映射 1" }));
    fireEvent.change(row.getByLabelText("目标路径第 1 层"), { target: { value: "核对值" } }); fireEvent.change(row.getByLabelText("字段来源"), { target: { value: "literal" } }); fireEvent.change(row.getByLabelText("固定值（数据格式）"), { target: { value: "false" } });
    expect(screen.getByLabelText("未应用配置提醒")).toHaveTextContent("2 处");
    fireEvent.click(editor.getByRole("button", { name: "应用到当前草稿" }));
    expect(screen.getByLabelText("未应用配置提醒")).toHaveTextContent("1 处"); expect(row.getByLabelText("固定值（数据格式）")).toHaveValue("false");
    const saveButton = screen.getByRole("button", { name: "保存草稿" });
    expect(saveButton).toBeDisabled();
    await userEvent.click(saveButton);
    expect(saveWorkflowAction).not.toHaveBeenCalled();
    expect(row.getByLabelText("固定值（数据格式）")).toHaveValue("false");
    const mapping = within(editor.getByRole("region", { name: "步骤输入字段映射" }));
    fireEvent.click(mapping.getByRole("button", { name: "重新读取当前草稿" }));
    expect(screen.getByLabelText("未应用配置提醒")).toHaveTextContent("1 处");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "明确确认本次修改" }));
    expect(screen.queryByLabelText("未应用配置提醒")).not.toBeInTheDocument();
    expect(editor.getByRole("checkbox", { name: "设置业务操作防重" })).toBeChecked();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeEnabled();
    const saved = await save();
    expect(saved.nodes.top).not.toHaveProperty("inputMapping");
    expect(saved.nodes.top.tool).toEqual(workflow.nodes.top.tool);
    expect(saved).toEqual({ ...workflow, nodes: { ...workflow.nodes, top: { ...workflow.nodes.top, toolOperation: { scope: tool.scope, key: { kind: "literal", value: 0 } } } } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("真实父回调拒绝不显示成功，保留填写和原组内数据", async () => {
    const tool = nodeToolOperationTestOption(), workflow = nodeToolOperationWorkflow(tool), rejected = vi.fn(() => false);
    render(<NodeInspector node={workflow.nodes.group} workflow={workflow} toolOptions={[tool]} onNodeChange={rejected} onNodeDelete={vi.fn()} />);
    await userEvent.click(screen.getByLabelText("步骤组步骤 2输入与结果约定"));
    const editor = within(await screen.findByRole("region", { name: "步骤组步骤 2字段约定" })); fixed(editor, "12");
    fireEvent.click(editor.getByRole("button", { name: "应用到当前草稿" }));
    expect(rejected).toHaveBeenCalledTimes(1); expect(editor.getByLabelText("固定业务标识")).toHaveValue("12"); expect(editor.queryByText("防重规则已应用到当前页面草稿，尚未保存或发布。")).not.toBeInTheDocument();
    expect(workflow.nodes.group.subflow!.steps[1]).not.toHaveProperty("toolOperation");
  });
  it("登记A→B→A拒绝旧清除确认，不调用保存", async () => {
    const { props, rerender, tool } = canvas(true); const editor = await panel();
    fireEvent.click(editor.getByRole("checkbox", { name: "设置业务操作防重" }));
    await act(async () => rerender(<FlowCanvas {...props} toolOptions={[{ ...tool, businessIdempotencyRetentionMs: 600000 }]} />));
    await act(async () => rerender(<FlowCanvas {...props} />));
    fireEvent.click(screen.getByRole("button", { name: "确认清除防重规则" }));
    expect(editor.getByRole("alert")).toHaveTextContent("重新确认"); expect(editor.getByRole("checkbox", { name: "设置业务操作防重" })).toBeChecked(); expect(saveWorkflowAction).not.toHaveBeenCalled();
  });
  it("清除须明确确认且保存只移除本规则，取消不改变原稿", async () => {
    const { workflow } = canvas(true), editor = await panel();
    fireEvent.click(editor.getByRole("checkbox", { name: "设置业务操作防重" })); fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    fireEvent.click(editor.getByRole("checkbox", { name: "设置业务操作防重" })); fireEvent.click(screen.getByRole("button", { name: "确认清除防重规则" }));
    const expected = { ...workflow.nodes.top }; delete expected.toolOperation;
    expect((await save()).nodes.top).toEqual(expected);
  });
});
