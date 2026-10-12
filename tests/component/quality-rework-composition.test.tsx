import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";
import { FlowCanvas } from "@/features/workflow-canvas/FlowCanvas";
import { NodeInspector } from "@/features/workflow-canvas/NodeInspector";
import { applyInlineNodeContract, applyTopLevelNodeContract, readInlineContractNode } from "@/features/workflow-canvas/node-contract-editing";
import { saveWorkflowAction } from "@/server/actions/save-workflow";
import { qualityGateReworkDraft } from "../fixtures/quality-gate-rework";
import { nodeContractWorkflow } from "../fixtures/node-contract-workflow";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/server/actions/save-workflow", () => ({ saveWorkflowAction: vi.fn() }));
vi.mock("@xyflow/react", () => ({ ReactFlow: () => <div aria-label="测试画布" />, Background: () => null, Controls: () => null }));
const writerId = "writer-private", reviewId = "review-private";
beforeEach(() => { vi.clearAllMocks(); vi.mocked(saveWorkflowAction).mockReset(); window.sessionStorage.clear(); vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function draft() {
  const raw = qualityGateReworkDraft(), parsed = WorkflowDraft.parse(raw);
  return { ...parsed, originalRoot: raw.originalRoot, nodes: { ...parsed.nodes, [writerId]: { ...parsed.nodes[writerId], retry: raw.nodes[writerId].retry, originalNode: raw.nodes[writerId].originalNode } } } as WorkflowDraft;
}
function canvas(workflow = draft()) {
  const props = { agentId: workflow.rootAgent.id, draft: workflow, draftUpdatedAt: "2026-10-10T00:00:00.000Z", agentTargets: [], toolOptions: [], knowledgeSources: [] };
  return { ...render(<FlowCanvas {...props} />), props, workflow };
}
async function select(id: string) { await userEvent.selectOptions(screen.getByRole("combobox", { name: "定位流程步骤" }), id); }
async function open(id = writerId, label = "当前步骤") {
  await select(id);
  const summary = screen.getByLabelText(label + "输入与结果约定");
  if (!(summary.closest("details") as HTMLDetailsElement).open) await userEvent.click(summary);
  return within(await screen.findByRole("region", { name: label + "字段约定" }));
}
function edit(value = "3") {
  const region = within(screen.getByRole("region", { name: "智能处理自动返工上限" }));
  fireEvent.click(region.getByRole("button", { name: /编辑返工上限|设置返工上限/ }));
  fireEvent.change(region.getByLabelText("包含首次处理的总尝试次数"), { target: { value } });
  return region;
}
function ask(region: ReturnType<typeof within>) { fireEvent.click(region.getByRole("button", { name: "应用到画布草稿" })); }
function confirm() { fireEvent.click(screen.getByRole("button", { name: "确认应用返工上限" })); }
async function save() {
  vi.mocked(saveWorkflowAction).mockResolvedValue({ ok: true, updatedAt: "2026-10-10T00:00:01.000Z" });
  await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));
  await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled());
  return vi.mocked(saveWorkflowAction).mock.calls[0][1];
}

describe("质量检查与返工的真实画布接线", () => {
  it("明确应用后才保存且仅改变顶层次数，未知字段、等待和规则均保留", async () => {
    const { workflow } = canvas(); await open(); const region = edit("1");
    expect(screen.getByLabelText("未应用配置提醒")).toHaveTextContent("1 处");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    ask(region); expect(saveWorkflowAction).not.toHaveBeenCalled(); confirm();
    expect(screen.queryByLabelText("未应用配置提醒")).not.toBeInTheDocument();
    expect(region.queryByLabelText("包含首次处理的总尝试次数")).not.toBeInTheDocument();
    const saved = await save();
    expect(saved).toEqual({ ...workflow, nodes: { ...workflow.nodes, [writerId]: { ...workflow.nodes[writerId], retry: { ...workflow.nodes[writerId].retry, maxAttempts: 1 } } } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("切换与关闭后保留返工填写，填写不写存储也不进入保存草稿", async () => {
    canvas(); await open(); const storage = vi.spyOn(Storage.prototype, "setItem"); edit("4");
    await select(reviewId); await open();
    expect(screen.getByLabelText("包含首次处理的总尝试次数")).toHaveValue("4");
    await userEvent.click(screen.getAllByRole("button", { name: "关闭节点详情" })[0]); await open();
    expect(screen.getByLabelText("包含首次处理的总尝试次数")).toHaveValue("4");
    expect(screen.getByLabelText("未应用配置提醒")).toHaveTextContent("1 处");
    expect(storage).not.toHaveBeenCalled(); expect(saveWorkflowAction).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("取消确认保留填写，取消本页填写不改当前次数", async () => {
    canvas(); await open(); const region = edit("4"); ask(region);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "返回" }));
    expect(region.getByLabelText("包含首次处理的总尝试次数")).toHaveValue("4");
    fireEvent.click(region.getByRole("button", { name: "取消本页填写" }));
    expect(region.getByText(/当前画布总尝试上限：2 次/)).toBeInTheDocument();
    expect(screen.queryByLabelText("未应用配置提醒")).not.toBeInTheDocument(); expect(saveWorkflowAction).not.toHaveBeenCalled();
  });
  it("仅清除已接受的返工填写，输入与结果填写继续保留且不进入保存", async () => {
    const { workflow } = canvas(), panel = await open();
    fireEvent.click(panel.getByRole("button", { name: "开始配置输入映射" })); fireEvent.click(panel.getByRole("button", { name: "添加字段映射" }));
    const row = within(panel.getByRole("group", { name: "字段映射 1" }));
    fireEvent.change(row.getByLabelText("目标路径第 1 层"), { target: { value: "金额" } }); fireEvent.change(row.getByLabelText("字段来源"), { target: { value: "literal" } }); fireEvent.change(row.getByLabelText("固定值（数据格式）"), { target: { value: "false" } });
    fireEvent.click(panel.getByRole("checkbox", { name: "使用结构化结果" })); fireEvent.change(panel.getByLabelText("结果字段规则"), { target: { value: "{" } });
    const region = edit("3"); expect(screen.getByLabelText("未应用配置提醒")).toHaveTextContent("3 处"); ask(region); confirm();
    expect(screen.getByLabelText("未应用配置提醒")).toHaveTextContent("2 处"); expect(row.getByLabelText("固定值（数据格式）")).toHaveValue("false"); expect(panel.getByLabelText("结果字段规则")).toHaveValue("{");
    expect(panel.getByRole("button", { name: "应用到当前草稿" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("region", { name: "流程设计" }), { key: "s", ctrlKey: true });
    expect(saveWorkflowAction).not.toHaveBeenCalled();
    expect(screen.getByLabelText("未应用配置提醒")).toHaveTextContent("2 处");
    expect(row.getByLabelText("固定值（数据格式）")).toHaveValue("false"); expect(panel.getByLabelText("结果字段规则")).toHaveValue("{");
    fireEvent.click(panel.getByRole("button", { name: "重新读取当前草稿" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "明确确认本次修改" }));
    expect(screen.getByLabelText("未应用配置提醒")).toHaveTextContent("1 处");
    expect(panel.getByLabelText("结果字段规则")).toHaveValue("{");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    fireEvent.click(panel.getByRole("button", { name: "取消编辑" }));
    expect(screen.queryByLabelText("未应用配置提醒")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeEnabled();
    const saved = await save(); expect(saved).toEqual({ ...workflow, nodes: { ...workflow.nodes, [writerId]: { ...workflow.nodes[writerId], retry: { ...workflow.nodes[writerId].retry, maxAttempts: 3 } } } });
  });
  it("已发出的次数保存回执不清期间输入与结果双类填写，下一次保存仍被保护", async () => {
    let resolve!: (value: { ok: true; updatedAt: string }) => void;
    vi.mocked(saveWorkflowAction).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const { workflow } = canvas(), panel = await open();
    const region = edit("3"); ask(region); confirm();
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    expect(saveWorkflowAction).toHaveBeenCalledOnce();
    fireEvent.click(panel.getByRole("button", { name: "开始配置输入映射" })); fireEvent.click(panel.getByRole("button", { name: "添加字段映射" }));
    const row = within(panel.getByRole("group", { name: "字段映射 1" }));
    fireEvent.change(row.getByLabelText("目标路径第 1 层"), { target: { value: "金额" } });
    fireEvent.change(row.getByLabelText("字段来源"), { target: { value: "literal" } });
    fireEvent.change(row.getByLabelText("固定值（数据格式）"), { target: { value: "false" } });
    fireEvent.click(panel.getByRole("checkbox", { name: "使用结构化结果" })); fireEvent.change(panel.getByLabelText("结果字段规则"), { target: { value: "{" } });
    expect(screen.getByLabelText("未应用配置提醒")).toHaveTextContent("2 处");
    await act(async () => { resolve({ ok: true, updatedAt: "2026-10-10T00:00:01.000Z" }); });
    expect(row.getByLabelText("固定值（数据格式）")).toHaveValue("false"); expect(panel.getByLabelText("结果字段规则")).toHaveValue("{");
    expect(screen.getByLabelText("未应用配置提醒")).toHaveTextContent("2 处");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    expect(vi.mocked(saveWorkflowAction).mock.calls[0][1]).toEqual({ ...workflow, nodes: { ...workflow.nodes, [writerId]: { ...workflow.nodes[writerId], retry: { ...workflow.nodes[writerId].retry, maxAttempts: 3 } } } });
    fireEvent.keyDown(screen.getByRole("region", { name: "流程设计" }), { key: "s", metaKey: true });
    expect(saveWorkflowAction).toHaveBeenCalledOnce();
    expect(row.getByLabelText("固定值（数据格式）")).toHaveValue("false"); expect(panel.getByLabelText("结果字段规则")).toHaveValue("{");
    expect(screen.getByLabelText("未应用配置提醒")).toHaveTextContent("2 处");
  });

  it("接受相同值不增加撤销历史，也不制造待保存修改", async () => {
    canvas(); await open(); const region = edit("2"); ask(region); confirm();
    expect(region.getByRole("status")).toHaveTextContent("画布已明确接收");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "撤销上一步修改" })).toBeDisabled();
    expect(saveWorkflowAction).not.toHaveBeenCalled();
  });
  it("次数应用后撤销重做沿既有历史，不复活已应用的填写", async () => {
    canvas(); await open(); const region = edit("3"); ask(region); confirm();
    await userEvent.click(screen.getByRole("button", { name: "撤销上一步修改" }));
    expect(region.getByText(/当前画布总尝试上限：2 次/)).toBeInTheDocument();
    expect(region.queryByLabelText("包含首次处理的总尝试次数")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重做上一步修改" }));
    expect(region.getByText(/当前画布总尝试上限：3 次/)).toBeInTheDocument();
    expect(screen.queryByLabelText("未应用配置提醒")).not.toBeInTheDocument();
  });
  it("确认期间画布变化再撤销回同值，旧确认失效且填写保留", async () => {
    canvas(); await open(); const region = edit("3"); ask(region);
    fireEvent.change(screen.getByLabelText("节点名称"), { target: { value: "变更后的方案" } });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "撤销上一步修改" })).not.toBeInTheDocument();
    // 模拟确认期间的外部修订，不把被模态遮挡的历史入口当作可点击界面。
    const undo = screen.getByLabelText("撤销上一步修改");
    expect(undo).toBeEnabled(); fireEvent.click(undo); confirm();
    expect(region.getByLabelText("包含首次处理的总尝试次数")).toHaveValue("3");
    expect(region.getByRole("button", { name: "应用到画布草稿" })).toBeDisabled();
    expect(region.getAllByRole("alert").some((alert) => alert.textContent?.includes("原确认失效"))).toBe(true);
    expect(saveWorkflowAction).not.toHaveBeenCalled();
  });
  it("本地填写同批 A→B→A 不能沿用原确认", async () => {
    canvas(); await open(); const region = edit("3"); ask(region);
    const input = region.getByLabelText("包含首次处理的总尝试次数");
    act(() => { fireEvent.change(input, { target: { value: "4" } }); fireEvent.change(input, { target: { value: "3" } }); }); confirm();
    expect(input).toHaveValue("3"); expect(region.getByRole("alert")).toHaveTextContent("本页填写已经变化");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
  });
  it("真实父层语义校验失败，不清填写或假报应用成功", async () => {
    const workflow = draft(); workflow.nodes[writerId].inputMapping = { fields: [{ target: ["金额"], source: { kind: "output", nodeId: "missing-source", path: [] }, required: true }], includeUpstreamOutputs: false };
    canvas(workflow); await open(); const region = edit("3"); ask(region); confirm();
    expect(region.getByLabelText("包含首次处理的总尝试次数")).toHaveValue("3");
    expect(region.getByRole("alert")).toHaveTextContent("没有明确接受");
    expect(region.queryByRole("status")).not.toBeInTheDocument(); expect(saveWorkflowAction).not.toHaveBeenCalled();
  });
  it("当前质量设置只称有效配置，定位唯一实际来源，不证明已执行", async () => {
    canvas(); await select(reviewId);
    const quality = within(screen.getByRole("region", { name: "交付前检查规则核对" }));
    expect(quality.queryByText("原始字段已保存")).not.toBeInTheDocument();
    expect(quality.getAllByText(/原字段是否显式保存无法/)).toHaveLength(4);
    expect(quality.getByText(/不证明来源已执行/)).toBeInTheDocument();
    fireEvent.click(quality.getByRole("button", { name: "定位来源步骤：生成方案" }));
    expect(screen.getByLabelText("节点名称")).toHaveValue("生成方案"); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([["group", "步骤组步骤 1"], ["parallel", "并行工作 1 步骤 1"]])("组内只读说明不生效，不开放自动返工编辑：%s", async (id, label) => {
    const workflow = nodeContractWorkflow(); canvas(workflow); const panel = await open(id, label);
    expect(panel.getByText(/当前质量检查不会自动返工组内步骤/)).toBeInTheDocument();
    expect(panel.queryByRole("button", { name: /编辑返工上限|设置返工上限/ })).not.toBeInTheDocument();
    expect(saveWorkflowAction).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("没有画布修订与填写保留时返工只读，不伪造修订或调用父层", async () => {
    const workflow = draft(), change = vi.fn(() => true);
    render(<NodeInspector node={workflow.nodes[writerId]} workflow={workflow} onNodeChange={change} onNodeDelete={vi.fn()} />);
    await userEvent.click(screen.getByLabelText("当前步骤输入与结果约定"));
    expect(screen.getByText(/返工编辑暂不可用/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /编辑返工上限|设置返工上限/ })).not.toBeInTheDocument(); expect(change).not.toHaveBeenCalled();
  });
  it("通用接受器只复制选中的 retry，不借机覆盖其他字段，且拒绝组内", () => {
    const workflow = draft(), node = workflow.nodes[writerId];
    const next = { ...node, retry: { ...node.retry!, maxAttempts: 3 }, inputMapping: { fields: [], includeUpstreamOutputs: true } };
    const result = applyTopLevelNodeContract(workflow, node, next, "retry");
    expect(result).toMatchObject({ ok: true, node: { retry: { maxAttempts: 3, backoffMs: 500 } } });
    if (result.ok) expect(result.node).not.toHaveProperty("inputMapping");
    const groups = nodeContractWorkflow(), parent = groups.nodes.group, location = { stepIndex: 0 }, inline = readInlineContractNode(parent, location);
    if (!inline.ok) throw new Error(inline.error);
    expect(applyInlineNodeContract(groups, parent, location, inline.node, { ...inline.node, retry: { maxAttempts: 3, backoffMs: 750 } }, "retry").ok).toBe(false);
    expect(applyTopLevelNodeContract(workflow, workflow.nodes[reviewId], workflow.nodes[reviewId], "retry").ok).toBe(false);
  });
});
