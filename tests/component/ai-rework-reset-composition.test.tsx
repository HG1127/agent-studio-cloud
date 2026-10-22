import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";
import { AiReworkLimitEditor } from "@/features/workflow-canvas/AiReworkLimitEditor";
import { FlowCanvas } from "@/features/workflow-canvas/FlowCanvas";
import { NodeContractEditors } from "@/features/workflow-canvas/NodeContractEditors";
import { NodeContractEditContext, NodeContractEditStore, type ContractCommit } from "@/features/workflow-canvas/use-node-contract-edits";
import { acceptAiReworkResetRequest, type AiReworkResetRequest } from "@/features/workflow-canvas/ai-rework-editing";
import { saveWorkflowAction } from "@/server/actions/save-workflow";
import { aiReworkResetDraft } from "../fixtures/ai-rework-reset";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/server/actions/save-workflow", () => ({ saveWorkflowAction: vi.fn() }));
vi.mock("@xyflow/react", () => ({ ReactFlow: () => <div aria-label="测试画布" />, Background: () => null, Controls: () => null }));
const writerId = "writer-private", reviewId = "review-private";
beforeEach(() => {
  vi.clearAllMocks(); vi.mocked(saveWorkflowAction).mockReset(); window.sessionStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })); vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function leaf(draft: unknown, reset: (request: AiReworkResetRequest) => boolean, revision = 4) {
  return render(<AiReworkLimitEditor originalDraft={draft} nodeId={writerId} revision={revision} source="draft" onApply={() => false} onReset={reset} />);
}
function start() { fireEvent.click(screen.getByRole("button", { name: "编辑返工上限" })); }
function fill(value: string) { fireEvent.change(screen.getByLabelText("包含首次处理的总尝试次数"), { target: { value } }); }
function ask() { fireEvent.click(screen.getByRole("button", { name: "恢复质量返工默认设置" })); }
function confirm() { fireEvent.click(screen.getByRole("button", { name: "确认恢复质量返工默认" })); }
function canvas() {
  const raw = aiReworkResetDraft(), parsed = WorkflowDraft.parse(raw);
  const draft = { ...parsed, originalRoot: raw.originalRoot, nodes: { ...parsed.nodes, [writerId]: { ...parsed.nodes[writerId], originalNode: raw.nodes[writerId].originalNode } } } as WorkflowDraft;
  render(<FlowCanvas agentId={draft.rootAgent.id} draft={draft} draftUpdatedAt="2026-10-10T00:00:00.000Z" agentTargets={[]} toolOptions={[]} knowledgeSources={[]} />); return draft;
}
function select(id: string) { fireEvent.change(screen.getByRole("combobox", { name: "定位流程步骤" }), { target: { value: id } }); }
async function openWriter() { select(writerId); await userEvent.click(screen.getByLabelText("当前步骤输入与结果约定")); }
async function save() {
  vi.mocked(saveWorkflowAction).mockResolvedValue({ ok: true, updatedAt: "2026-10-10T00:00:01.000Z" }); fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
  await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledOnce()); return vi.mocked(saveWorkflowAction).mock.calls[0][1];
}

describe("返工默认恢复叶子的确认与接收", () => {
  it("单独确认，取消保留填写，严格接收后才清；恢复不禁止返工、不保存或执行", () => {
    const original = aiReworkResetDraft(), reset = vi.fn((request: AiReworkResetRequest) => acceptAiReworkResetRequest(original, 4, writerId, request).ok);
    const network = vi.spyOn(globalThis, "fetch"), storage = vi.spyOn(Storage.prototype, "setItem"); leaf(original, reset); start(); fill("8"); ask();
    expect(reset).not.toHaveBeenCalled(); expect(screen.getByRole("dialog")).toHaveTextContent("最多额外返工一次");
    expect(screen.getByRole("dialog")).toHaveTextContent("这不等于禁止返工");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "返回" })); expect(screen.getByLabelText("包含首次处理的总尝试次数")).toHaveValue("8");
    ask(); confirm(); expect(reset).toHaveBeenCalledOnce(); expect(reset.mock.calls[0][0]).not.toHaveProperty("attemptsText");
    expect(screen.queryByLabelText("包含首次处理的总尝试次数")).not.toBeInTheDocument(); expect(screen.getByRole("status")).toHaveTextContent("未恢复旧版本设置");
    expect(original.nodes[writerId].retry.maxAttempts).toBe(1); expect(network).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
  });

  it.each(["false", "void", "throw", "promise"])("父层%s不清填写，不显示接收成功", (mode) => {
    const reset = vi.fn(() => { if (mode === "throw") throw new Error("拒绝"); return mode === "promise" ? Promise.resolve(true) : mode === "void" ? undefined : false; });
    leaf(aiReworkResetDraft(), reset as unknown as (request: AiReworkResetRequest) => boolean); start(); fill("8"); ask(); confirm();
    expect(screen.getByLabelText("包含首次处理的总尝试次数")).toHaveValue("8"); expect(screen.queryByRole("status")).not.toBeInTheDocument(); expect(reset).toHaveBeenCalledOnce();
  });

  it("局部同批次ABA与外部同JSON新修订不能复用旧恢复确认", () => {
    const original = aiReworkResetDraft(), reset = vi.fn(() => true); const { rerender } = leaf(original, reset); start(); fill("8"); ask();
    act(() => { fill("7"); fill("8"); }); confirm(); expect(reset).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toHaveTextContent("原确认失效");
    ask(); rerender(<AiReworkLimitEditor originalDraft={structuredClone(original)} nodeId={writerId} revision={6} source="draft" onApply={() => false} onReset={reset} />);
    confirm(); expect(reset).not.toHaveBeenCalled(); expect(screen.getByLabelText("包含首次处理的总尝试次数")).toHaveValue("8");
  });

  it("没有恢复接收入口或有未知额外字段时不展示假恢复按钮", () => {
    const original = aiReworkResetDraft(); const { rerender } = render(<AiReworkLimitEditor originalDraft={original} nodeId={writerId} revision={4} onApply={() => false} />);
    start(); expect(screen.queryByRole("button", { name: "恢复质量返工默认设置" })).not.toBeInTheDocument(); fireEvent.click(screen.getByRole("button", { name: "取消本页填写" }));
    const extra = { ...original, nodes: { ...original.nodes, [writerId]: { ...original.nodes[writerId], retry: { ...original.nodes[writerId].retry, future: false } } } };
    rerender(<AiReworkLimitEditor originalDraft={extra} nodeId={writerId} revision={5} onApply={() => false} onReset={() => false} />); start();
    expect(screen.queryByRole("button", { name: "恢复质量返工默认设置" })).not.toBeInTheDocument(); expect(screen.getByText(/不能整项移除/)).toBeInTheDocument();
  });
});

describe("返工恢复真实画布历史与保存", () => {
  it("接收过程中出现更新的同类填写时，旧确认只清自己的修订", async () => {
    const draft = WorkflowDraft.parse(aiReworkResetDraft()), identity = { parentId: writerId }, store = new NodeContractEditStore();
    store.observe(draft.rootAgent.id, draft);
    const commit = vi.fn((request: ContractCommit) => {
      if (!store.accepts(request)) return false;
      const entry = store.read(identity, "retry");
      if (!entry) return false;
      store.write(identity, "retry", { ...entry.value, attempts: "7" }, true);
      return true;
    });
    render(<NodeContractEditContext.Provider value={{ store, epoch: store.epoch, pendingCount: 0, refresh: vi.fn(), commit }}>
      <NodeContractEditors node={draft.nodes[writerId]} workflow={draft} onNodeChange={() => false} />
    </NodeContractEditContext.Provider>);
    await userEvent.click(screen.getByLabelText("当前步骤输入与结果约定")); start(); fill("8"); ask();
    const confirmedRevision = store.read(identity, "retry")!.revision; confirm();
    expect(commit).toHaveBeenCalledOnce(); expect(commit.mock.calls[0][0].revision).toBe(confirmedRevision);
    expect(store.read(identity, "retry")!.revision).toBeGreaterThan(confirmedRevision);
    expect(store.read(identity, "retry")!.value.attempts).toBe("7"); expect(store.pendingCount).toBe(1);
    expect(screen.getByLabelText("包含首次处理的总尝试次数")).toHaveValue("7");
  });

  it("明确接收后只移除本步骤retry，撤销重做与真实保存不补缺省", async () => {
    const draft = canvas(); await openWriter(); start(); fill("8"); ask(); expect(saveWorkflowAction).not.toHaveBeenCalled(); confirm();
    expect(screen.queryByLabelText("未应用配置提醒")).not.toBeInTheDocument(); expect(screen.getByText(/当前画布没有尝试设置/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "撤销上一步修改" })); expect(screen.getByText(/当前画布总尝试上限：1 次/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重做上一步修改" })); expect(screen.getByText(/当前画布没有尝试设置/)).toBeInTheDocument();
    const saved = await save(), { retry, ...node } = draft.nodes[writerId]; expect(retry).toBeDefined();
    expect(saved).toEqual({ ...draft, nodes: { ...draft.nodes, [writerId]: node } }); expect(Object.hasOwn(saved.nodes[writerId], "retry")).toBe(false); expect(fetch).not.toHaveBeenCalled();
  });

  it("当前输入来源语义有误时真实父层拒绝，不清本类填写", async () => {
    const original = aiReworkResetDraft(), draft = WorkflowDraft.parse(original);
    draft.nodes[writerId].inputMapping = { fields: [{ target: ["金额"], source: { kind: "output", nodeId: "missing-source", path: [] }, required: true }], includeUpstreamOutputs: false };
    render(<FlowCanvas agentId={draft.rootAgent.id} draft={draft} draftUpdatedAt="2026-10-10T00:00:00.000Z" agentTargets={[]} toolOptions={[]} knowledgeSources={[]} />);
    await openWriter(); start(); fill("8"); ask(); confirm();
    expect(screen.getByLabelText("包含首次处理的总尝试次数")).toHaveValue("8"); expect(screen.getByRole("region", { name: "智能处理自动返工上限" })).toHaveTextContent("没有明确接受");
    expect(screen.getByLabelText("未应用配置提醒")).toHaveTextContent("1 处"); expect(saveWorkflowAction).not.toHaveBeenCalled();
  });

  it("恢复只清返工，另一类未应用质量规则继续保留但不能覆盖新代次", async () => {
    const draft = canvas(); select(reviewId); fireEvent.click(screen.getByRole("button", { name: "编辑交付质量规则" })); fireEvent.click(screen.getByRole("button", { name: "编辑质量规则" }));
    fireEvent.change(screen.getByLabelText("最低有效结果数量"), { target: { value: "0" } });
    await openWriter(); start(); fill("8"); expect(screen.getByLabelText("未应用配置提醒")).toHaveTextContent("2 处"); ask(); confirm();
    expect(screen.getByLabelText("未应用配置提醒")).toHaveTextContent("1 处"); select(reviewId);
    expect(screen.getByLabelText("最低有效结果数量")).toHaveValue("0"); expect(screen.getByRole("button", { name: "应用质量规则到画布" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "取消质量填写" }));
    const saved = await save(); expect(saved.nodes[reviewId]).toEqual(draft.nodes[reviewId]); expect(Object.hasOwn(saved.nodes[writerId], "retry")).toBe(false);
  });
});
