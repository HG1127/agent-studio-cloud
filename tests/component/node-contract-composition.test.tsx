import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_WORKFLOW_BYTES, WorkflowDraft } from "@/contracts/workflow";
import { InputMappingPreviewResult } from "@/contracts/input-mapping-preview";
import { POST } from "@/app/api/workflows/input-preview/route";
import { saveWorkflowAction } from "@/server/actions/save-workflow";
import { FlowCanvas } from "@/features/workflow-canvas/FlowCanvas";
import { NodeInspector } from "@/features/workflow-canvas/NodeInspector";
import { contractSchema, nodeContractWorkflow } from "../fixtures/node-contract-workflow";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/server/actions/save-workflow", () => ({ saveWorkflowAction: vi.fn() }));
vi.mock("@xyflow/react", () => ({ ReactFlow: () => <div aria-label="测试画布" />, Background: () => null, Controls: () => null }));
const revision = "2026-10-09T00:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks(); vi.mocked(saveWorkflowAction).mockReset();
  window.sessionStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function canvas(draft = nodeContractWorkflow()) {
  return render(<FlowCanvas agentId={draft.rootAgent.id} draft={draft} draftUpdatedAt={revision} agentTargets={[]} toolOptions={[]} knowledgeSources={[]} />);
}
async function open(label: string) {
  await userEvent.click(screen.getByLabelText(label + "输入与结果约定"));
  return within(await screen.findByRole("region", { name: label + "字段约定" }));
}
function configureLiteral(panel: ReturnType<typeof within>, value = "false") {
  fireEvent.click(panel.getByRole("button", { name: "开始配置输入映射" }));
  fireEvent.click(panel.getByRole("button", { name: "添加字段映射" }));
  const row = within(panel.getByRole("group", { name: "字段映射 1" }));
  fireEvent.change(row.getByRole("textbox", { name: "目标路径第 1 层" }), { target: { value: "业务.字段" } });
  fireEvent.change(row.getByRole("combobox", { name: "字段来源" }), { target: { value: "literal" } });
  fireEvent.change(row.getByRole("textbox", { name: "固定值（数据格式）" }), { target: { value } });
}
async function applyInput(panel: ReturnType<typeof within>) {
  await userEvent.click(panel.getByRole("button", { name: "校验并应用到画布草稿" }));
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "明确确认本次修改" }));
}
describe("字段组件接入实际画布", () => {
  it("收起再展开字段面板保留尚未应用的编辑，不靠本地存储保留样例", async () => {
    const draft = nodeContractWorkflow(), change = vi.fn();
    render(<NodeInspector node={draft.nodes.top} workflow={draft} onNodeChange={change} onNodeDelete={vi.fn()} />);
    const panel = await open("当前步骤");
    configureLiteral(panel, "false");
    const summary = screen.getByLabelText("当前步骤输入与结果约定");
    await userEvent.click(summary);
    await userEvent.click(summary);
    expect(panel.getByRole("textbox", { name: "固定值（数据格式）" })).toHaveValue("false");
    expect(change).not.toHaveBeenCalled();
  });
  it("默认折叠不挂载重表单、不写配置；缺完整草稿也不构造占位流程", async () => {
    const draft = nodeContractWorkflow(), change = vi.fn();
    render(<NodeInspector node={draft.nodes.top} onNodeChange={change} onNodeDelete={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "模型结果字段约定" })).not.toBeInTheDocument();
    const panel = await open("当前步骤");
    expect(panel.getByRole("status")).toHaveTextContent("完整流程草稿暂不可读");
    expect(panel.queryByRole("checkbox", { name: "使用结构化结果" })).not.toBeInTheDocument();
    expect(change).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("顶层输入配置实际进入撤销、重做和原保存动作，带原版本戳且不夹带模型默认配置", async () => {
    const draft = nodeContractWorkflow();
    vi.mocked(saveWorkflowAction).mockResolvedValue({ ok: true, updatedAt: "2026-10-09T00:00:01.000Z" });
    canvas(draft);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "定位流程步骤" }), "top");
    const panel = await open("当前步骤");
    configureLiteral(panel, "0");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    await applyInput(panel);
    expect(saveWorkflowAction).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "撤销上一步修改" }));
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "重做上一步修改" }));
    await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledOnce());
    const [agentId, saved, expectedRevision] = vi.mocked(saveWorkflowAction).mock.calls[0];
    expect(agentId).toBe(draft.rootAgent.id); expect(expectedRevision).toBe(revision);
    expect(saved.nodes.top.inputMapping).toEqual({ fields: [{ target: ["业务.字段"], source: { kind: "literal", value: 0 }, required: true }], includeUpstreamOutputs: false });
    expect(saved.nodes.top.modelOutput).toBeUndefined();
    expect(saved.nodes.top.retry).toEqual(draft.nodes.top.retry);
    expect(saved.nodes.group).toEqual(draft.nodes.group);
    expect(WorkflowDraft.safeParse(saved).success).toBe(true);
  });
  it.each([{ parentId: "group", label: "步骤组步骤 1" }, { parentId: "parallel", label: "并行工作 1 步骤 1" }])("$label 输入与模型规则保存到原步骤，绝不新增运行时顶层节点", async ({ parentId, label }) => {
    const draft = nodeContractWorkflow();
    vi.mocked(saveWorkflowAction).mockResolvedValue({ ok: true, updatedAt: "2026-10-09T00:00:01.000Z" });
    canvas(draft);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "定位流程步骤" }), parentId);
    const panel = await open(label);
    configureLiteral(panel);
    await applyInput(panel);
    await userEvent.click(panel.getByRole("checkbox", { name: "使用结构化结果" }));
    fireEvent.change(panel.getByLabelText("结果字段规则"), { target: { value: JSON.stringify(contractSchema) } });
    fireEvent.change(panel.getByLabelText("额外格式修正次数"), { target: { value: "0" } });
    await userEvent.click(panel.getByRole("button", { name: "应用到当前草稿" }));
    expect(saveWorkflowAction).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "撤销上一步修改" }));
    expect(panel.getByRole("checkbox", { name: "使用结构化结果" })).not.toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "重做上一步修改" }));
    expect(panel.getByRole("checkbox", { name: "使用结构化结果" })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledOnce());
    const saved = vi.mocked(saveWorkflowAction).mock.calls[0][1];
    expect(Object.keys(saved.nodes)).toEqual(Object.keys(draft.nodes));
    const original = parentId === "group" ? draft.nodes.group.subflow!.steps[0] : draft.nodes.parallel.parallel!.branches[0].steps[0];
    const actual = parentId === "group" ? saved.nodes.group.subflow!.steps[0] : saved.nodes.parallel.parallel!.branches[0].steps[0];
    expect(actual).toEqual({ ...original, inputMapping: { fields: [{ target: ["业务.字段"], source: { kind: "literal", value: false }, required: true }], includeUpstreamOutputs: false },
      modelOutput: { format: "json", schema: contractSchema, providerMode: "json", maxRepairAttempts: 0 } });
    expect(actual.id).toBe(original.id);
    expect(saved.nodes.top).toEqual(draft.nodes.top);
    expect(WorkflowDraft.safeParse(saved).success).toBe(true);
  });
  it("组内模型草稿单独合法但累计容量过大时不回写，也不显示已应用成功", async () => {
    const draft = nodeContractWorkflow();
    const bytes = new TextEncoder().encode(JSON.stringify(draft)).byteLength;
    const large = WorkflowDraft.parse({ ...draft, intentSource: { padding: "x".repeat(MAX_WORKFLOW_BYTES - bytes - 400) } });
    const change = vi.fn();
    render(<NodeInspector node={large.nodes.group} workflow={large} workflowNodes={large.nodes} onNodeChange={change} onNodeDelete={vi.fn()} />);
    const panel = await open("步骤组步骤 1");
    await userEvent.click(panel.getByRole("checkbox", { name: "使用结构化结果" }));
    const schema = { ...contractSchema, description: "x".repeat(2000) };
    fireEvent.change(panel.getByLabelText("结果字段规则"), { target: { value: JSON.stringify(schema) } });
    await userEvent.click(panel.getByRole("button", { name: "应用到当前草稿" }));
    expect(change).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert").some((element) => /完整流程草稿未通过格式或容量校验/.test(element.textContent ?? ""))).toBe(true);
    expect(screen.queryByText("结果约定已应用到当前草稿，尚未保存或发布。")).not.toBeInTheDocument();
    expect(panel.getByLabelText("结果字段规则")).toHaveValue(JSON.stringify(schema));
  });
  it("组内输入映射整草稿容量拒绝会返回编辑器，不显示交给画布的成功反馈", async () => {
    const draft = nodeContractWorkflow(), change = vi.fn();
    const bytes = new TextEncoder().encode(JSON.stringify(draft)).byteLength;
    const large = WorkflowDraft.parse({ ...draft, intentSource: { padding: "x".repeat(MAX_WORKFLOW_BYTES - bytes - 400) } });
    render(<NodeInspector node={large.nodes.group} workflow={large} onNodeChange={change} onNodeDelete={vi.fn()} />);
    const panel = await open("步骤组步骤 1");
    const literal = JSON.stringify("x".repeat(2000));
    configureLiteral(panel, literal);
    await applyInput(panel);
    expect(change).not.toHaveBeenCalled();
    expect(panel.getByRole("textbox", { name: "固定值（数据格式）" })).toHaveValue(literal);
    expect(screen.queryByText(/已交给画布草稿，尚未保存到服务端/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("alert").some((element) => /完整流程草稿未通过格式或容量校验/.test(element.textContent ?? ""))).toBe(true);
  });
  it("输入定义变化会作废已打开的映射确认，保留本地固定值而不覆盖新草稿", async () => {
    const draft = nodeContractWorkflow(), change = vi.fn();
    const props = { node: draft.nodes.top, workflow: draft, workflowNodes: draft.nodes, onNodeChange: change, onNodeDelete: vi.fn() };
    const view = render(<NodeInspector {...props} />);
    const panel = await open("当前步骤"); configureLiteral(panel, "false");
    await userEvent.click(panel.getByRole("button", { name: "校验并应用到画布草稿" }));
    const changed = { ...draft, variables: [{ ...draft.variables[0], label: "新的运行输入" }] };
    view.rerender(<NodeInspector {...props} workflow={changed} />);
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "明确确认本次修改" }));
    expect(change).not.toHaveBeenCalled();
    expect(panel.getByRole("textbox", { name: "固定值（数据格式）" })).toHaveValue("false");
    expect(panel.getAllByRole("alert").some((element) => /确认失效/.test(element.textContent ?? ""))).toBe(true);
  });
  it("定义变化再恢复原值不会复活旧确认，必须明确重新读取当前草稿", async () => {
    const draft = nodeContractWorkflow(), change = vi.fn();
    const props = { node: draft.nodes.top, workflow: draft, onNodeChange: change, onNodeDelete: vi.fn() };
    const view = render(<NodeInspector {...props} />);
    const panel = await open("当前步骤"); configureLiteral(panel);
    await userEvent.click(panel.getByRole("button", { name: "校验并应用到画布草稿" }));
    view.rerender(<NodeInspector {...props} workflow={{ ...draft, variables: [] }} />);
    view.rerender(<NodeInspector {...props} />);
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "明确确认本次修改" }));
    expect(change).not.toHaveBeenCalled();
    expect(panel.getByRole("button", { name: "校验并应用到画布草稿" })).toBeDisabled();
    expect(panel.getByRole("textbox", { name: "固定值（数据格式）" })).toHaveValue("false");
  });
  it("组内字段参考试算调用真实只读路由，零和否由现有映射器计算，不调用画布保存", async () => {
    const draft = nodeContractWorkflow(), change = vi.fn();
    const responses: InputMappingPreviewResult[] = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers); headers.set("origin", "http://localhost");
      const response = await POST(new Request("http://localhost" + String(url), { ...init, headers }));
      responses.push(InputMappingPreviewResult.parse(await response.clone().json()));
      return response;
    });
    vi.stubGlobal("fetch", fetcher);
    render(<NodeInspector node={draft.nodes.group} workflow={draft} workflowNodes={draft.nodes} onNodeChange={change} onNodeDelete={vi.fn()} />);
    const panel = await open("步骤组步骤 1");
    configureLiteral(panel, "false");
    fireEvent.change(panel.getByLabelText("运行输入样例（数据格式）"), { target: { value: '{"金额":0}' } });
    await userEvent.click(panel.getByRole("button", { name: "提交样例做只读试算" }));
    await waitFor(() => expect(panel.getByLabelText("试算后的输入")).toHaveTextContent('"业务.字段": false'));
    expect(responses[0]).toMatchObject({ ok: true, executed: false, scope: "field-mapping", input: { "业务.字段": false }, outputs: {} });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(change).not.toHaveBeenCalled(); expect(saveWorkflowAction).not.toHaveBeenCalled();
    expect(panel.getByText(/不证明真实来源存在或运行成功/)).toBeVisible();
  });
});
