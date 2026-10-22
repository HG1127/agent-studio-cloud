import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useContext, useLayoutEffect, type ComponentProps, type ContextType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";
import { FlowCanvas } from "@/features/workflow-canvas/FlowCanvas";
import { AiReworkLimitEditor } from "@/features/workflow-canvas/AiReworkLimitEditor";
import { NodeContractEditContext, type ContractCommit } from "@/features/workflow-canvas/use-node-contract-edits";
import { requestWorkflowNodeFocus } from "@/lib/workflow-node-focus";
import { saveWorkflowAction } from "@/server/actions/save-workflow";
import { qualityGateRulesDraft } from "../fixtures/quality-gate-rules";

const capture = vi.hoisted(() => ({ context: null as ContextType<typeof NodeContractEditContext> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/server/actions/save-workflow", () => ({ saveWorkflowAction: vi.fn() }));
vi.mock("@/features/workflow-canvas/NodeInspector", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/workflow-canvas/NodeInspector")>();
  function Inspector(props: ComponentProps<typeof actual.NodeInspector>) {
    const context = useContext(NodeContractEditContext);
    useLayoutEffect(() => { capture.context = context; });
    return <actual.NodeInspector {...props} />;
  }
  return { ...actual, NodeInspector: Inspector };
});
vi.mock("@xyflow/react", () => ({
  ReactFlow: ({ onNodeClick, onPaneClick }: { onNodeClick: (event: unknown, node: { id: string }) => void; onPaneClick: () => void }) => <div>
    <button onClick={() => onNodeClick(null, { id: "writer-private" })}>测试画布选择生成步骤</button>
    <button onClick={onPaneClick}>测试画布空白处</button>
  </div>, Background: () => null, Controls: () => null,
}));

const writer = "writer-private", review = "review-private", revision = "2026-10-10T00:00:00.000Z";
beforeEach(() => {
  capture.context = null; vi.clearAllMocks(); vi.mocked(saveWorkflowAction).mockReset(); window.sessionStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function canvas() {
  const workflow = WorkflowDraft.parse(qualityGateRulesDraft());
  const props = { agentId: workflow.rootAgent.id, draft: workflow, draftUpdatedAt: revision, agentTargets: [], toolOptions: [], knowledgeSources: [] };
  const view = render(<FlowCanvas {...props} />);
  return { ...view, workflow, props, root: view.container.querySelector("section")! };
}
function select(id: string) { fireEvent.change(screen.getByRole("combobox", { name: "定位流程步骤" }), { target: { value: id } }); }
function quality() {
  select(review); fireEvent.click(screen.getByRole("button", { name: "编辑交付质量规则" }));
  const editor = within(screen.getByRole("region", { name: "交付前质量规则编辑" }));
  fireEvent.click(editor.getByRole("button", { name: "编辑质量规则" }));
  fireEvent.change(editor.getByLabelText("最低有效结果数量"), { target: { value: "0" } });
  fireEvent.click(editor.getByRole("button", { name: "应用质量规则到画布" }));
  fireEvent.click(screen.getByRole("button", { name: "确认应用质量规则" }));
}
async function openRework() {
  select(writer);
  const summary = screen.getByLabelText("当前步骤输入与结果约定");
  if (!(summary.closest("details") as HTMLDetailsElement).open) await userEvent.click(summary);
  return within(await screen.findByRole("region", { name: "智能处理自动返工上限" }));
}
async function beginRework() {
  const editor = await openRework(); fireEvent.click(editor.getByRole("button", { name: "编辑返工上限" }));
  fireEvent.change(editor.getByLabelText("包含首次处理的总尝试次数"), { target: { value: "4" } });
  return editor;
}
function expectedQuality(workflow: WorkflowDraft) {
  return { ...workflow, nodes: { ...workflow.nodes, [review]: { ...workflow.nodes[review], quality: { ...workflow.nodes[review].quality!, minOutputCount: 0 } } } };
}

describe("真实画布保存入口与已提交快照保护", () => {
  it.each(["ctrlKey", "metaKey"])("尚未应用的返工填写阻止按钮和 %s 保存，取消后只保存已接收的质量修改", async (modifier) => {
    const view = canvas(); quality(); const editor = await beginRework();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    fireEvent.keyDown(view.root, { key: "s", [modifier]: true });
    expect(screen.getByRole("alert")).toHaveTextContent("仍有未应用填写");
    expect(editor.getByLabelText("包含首次处理的总尝试次数")).toHaveValue("4");
    expect(saveWorkflowAction).not.toHaveBeenCalled();
    fireEvent.click(editor.getByRole("button", { name: "取消本页填写" }));
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeEnabled();
    vi.mocked(saveWorkflowAction).mockResolvedValue({ ok: true, updatedAt: "2026-10-10T00:00:01.000Z" });
    fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledOnce());
    expect(vi.mocked(saveWorkflowAction).mock.calls[0]).toEqual([view.workflow.rootAgent.id, expectedQuality(view.workflow), revision]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["button", "ctrlKey", "metaKey"])("同批开启填写与 %s 保存读实时存储，不能依赖旧渲染的按钮状态", async (entry) => {
    const view = canvas(); quality(); const editor = await openRework();
    const save = screen.getByRole("button", { name: "保存草稿" }); expect(save).toBeEnabled();
    act(() => {
      fireEvent.click(editor.getByRole("button", { name: "编辑返工上限" }));
      if (entry === "button") fireEvent.click(save);
      else fireEvent.keyDown(view.root, { key: "s", [entry]: true });
    });
    expect(saveWorkflowAction).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("仍有未应用填写");
    expect(screen.getByLabelText("未应用配置提醒")).toHaveTextContent("1 处");
    expect(save).toBeDisabled();
  });

  it("开启同值返工填写即待应用，明确接收相同值后不制造撤销记录", async () => {
    const view = canvas(); quality(); const editor = await openRework();
    fireEvent.click(editor.getByRole("button", { name: "编辑返工上限" }));
    expect(editor.getByLabelText("包含首次处理的总尝试次数")).toHaveValue(String(view.workflow.nodes[writer].retry!.maxAttempts));
    expect(screen.getByLabelText("未应用配置提醒")).toHaveTextContent("1 处");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    fireEvent.click(editor.getByRole("button", { name: "应用到画布草稿" }));
    fireEvent.click(screen.getByRole("button", { name: "确认应用返工上限" }));
    expect(screen.queryByLabelText("未应用配置提醒")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeEnabled();
    expect(saveWorkflowAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "撤销上一步修改" }));
    expect(screen.getByRole("button", { name: "撤销上一步修改" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("保存期间的新填写在回执后仍保留，不能被下一次快捷键保存", async () => {
    let resolve!: (value: { ok: true; updatedAt: string }) => void;
    vi.mocked(saveWorkflowAction).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const view = canvas(); quality(); fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    const editor = await beginRework();
    await act(async () => resolve({ ok: true, updatedAt: "2026-10-10T00:00:01.000Z" }));
    expect(editor.getByLabelText("包含首次处理的总尝试次数")).toHaveValue("4");
    expect(screen.getByText("提交时的草稿已保存；新填写尚未应用，仍保留在本页")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    fireEvent.keyDown(view.root, { key: "s", ctrlKey: true });
    expect(saveWorkflowAction).toHaveBeenCalledOnce();
    expect(vi.mocked(saveWorkflowAction).mock.calls[0][1]).toEqual(expectedQuality(view.workflow));
  });

  it("结果未知时允许带新填写核对，但两次动作仍用同一原草稿与原修订", async () => {
    vi.mocked(saveWorkflowAction).mockRejectedValueOnce(new Error("response lost"));
    const view = canvas(); quality(); fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "核对上次保存" })).toBeEnabled());
    const original = vi.mocked(saveWorkflowAction).mock.calls[0], editor = await beginRework();
    expect(screen.getByRole("button", { name: "核对上次保存" })).toBeEnabled();
    vi.mocked(saveWorkflowAction).mockResolvedValueOnce({ ok: true, updatedAt: "2026-10-10T00:00:01.000Z" });
    fireEvent.keyDown(view.root, { key: "s", metaKey: true });
    await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveWorkflowAction).mock.calls[1]).toEqual(original);
    expect(vi.mocked(saveWorkflowAction).mock.calls[1][1]).toBe(original[1]);
    expect(original).toEqual([view.workflow.rootAgent.id, expectedQuality(view.workflow), revision]);
    await waitFor(() => expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled());
    expect(editor.getByLabelText("包含首次处理的总尝试次数")).toHaveValue("4");
    expect(screen.getByLabelText("未应用配置提醒")).toHaveTextContent("1 处");
  });

  it("返工未配置时，同批修改两个字段不会丢掉前一次输入", () => {
    const workflow = qualityGateRulesDraft(); delete (workflow.nodes[writer] as { retry?: unknown }).retry;
    const onApply = vi.fn(() => true);
    render(<AiReworkLimitEditor originalDraft={workflow} nodeId={writer} revision={0} onApply={onApply} />);
    fireEvent.click(screen.getByRole("button", { name: "设置返工上限" }));
    act(() => {
      fireEvent.change(screen.getByLabelText("包含首次处理的总尝试次数"), { target: { value: "4" } });
      fireEvent.change(screen.getByLabelText("新设置所需的等待参数（毫秒）"), { target: { value: "800" } });
    });
    expect(screen.getByLabelText("包含首次处理的总尝试次数")).toHaveValue("4");
    expect(screen.getByLabelText("新设置所需的等待参数（毫秒）")).toHaveValue("800");
    fireEvent.click(screen.getByRole("button", { name: "应用到画布草稿" }));
    fireEvent.click(screen.getByRole("button", { name: "确认应用返工上限" }));
    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ nodeId: writer, attemptsText: "4", backoffText: "800" }));
  });
});

describe("节点选择事件即时更新实际父层的接收对象", () => {
  it("同一当前质量步骤的完整有效请求仍由真实父层接收", () => {
    const view = canvas(); select(review); const context = capture.context!, node = view.workflow.nodes[review];
    const request: ContractCommit = { identity: { parentId: review }, field: "quality", node: { ...node, quality: { ...node.quality!, minOutputCount: 0 } },
      expectedNode: node, expectedParent: node, epoch: context.store.epoch, generation: context.store.generation({ parentId: review }), revision: 0 };
    let accepted: boolean | undefined; act(() => { accepted = context.commit(request); });
    expect(accepted).toBe(true);
    expect(screen.getByRole("region", { name: "交付前检查规则核对" })).toHaveTextContent("0 项");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeEnabled();
    expect(saveWorkflowAction).not.toHaveBeenCalled();
  });

  it.each(["locator", "node", "focus", "close", "pane", "escape"])("同批 %s 离开质量步骤后，旧对象不能向完整草稿提交", (path) => {
    const view = canvas(); select(review);
    if (path === "node" || path === "pane") fireEvent.click(screen.getByRole("button", { name: "流程画布" }));
    if (path === "escape") fireEvent.click(screen.getByRole("button", { name: "全屏编辑流程" }));
    const context = capture.context!;
    const node = view.workflow.nodes[review];
    const request: ContractCommit = { identity: { parentId: review }, field: "quality", node: { ...node, quality: { ...node.quality!, minOutputCount: 0 } },
      expectedNode: node, expectedParent: node, epoch: context.store.epoch, generation: context.store.generation({ parentId: review }), revision: 0 };
    let accepted: boolean | undefined;
    act(() => {
      if (path === "locator") select(writer);
      else if (path === "node") fireEvent.click(screen.getByRole("button", { name: "测试画布选择生成步骤" }));
      else if (path === "focus") requestWorkflowNodeFocus({ agentId: view.workflow.rootAgent.id, nodeId: writer });
      else if (path === "close") fireEvent.click(screen.getAllByRole("button", { name: "关闭节点详情" })[0]);
      else if (path === "pane") fireEvent.click(screen.getByRole("button", { name: "测试画布空白处" }));
      else fireEvent.keyDown(window, { key: "Escape" });
      accepted = context.commit(request);
    });
    expect(accepted).toBe(false);
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    expect(saveWorkflowAction).not.toHaveBeenCalled();
    select(review); expect(screen.getByRole("region", { name: "交付前检查规则核对" })).toHaveTextContent("1 项");
  });
});
