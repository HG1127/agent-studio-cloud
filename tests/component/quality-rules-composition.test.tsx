import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowDraft } from "@/contracts/workflow";
import { FlowCanvas } from "@/features/workflow-canvas/FlowCanvas";
import { NodeInspector } from "@/features/workflow-canvas/NodeInspector";
import { QualityGateRulesEditor } from "@/features/workflow-canvas/QualityGateRulesEditor";
import { acceptQualityGateRulesRequest, type QualityGateRulesRequest } from "@/features/workflow-canvas/quality-gate-rules-editing";
import { applyInlineNodeContract, applyTopLevelNodeContract, readInlineContractNode } from "@/features/workflow-canvas/node-contract-editing";
import { qualityDisplay } from "@/features/workflow-canvas/quality-display";
import { saveWorkflowAction } from "@/server/actions/save-workflow";
import { qualityGateRulesDraft, removableQualityGateRulesDraft } from "../fixtures/quality-gate-rules";
import { nodeContractWorkflow } from "../fixtures/node-contract-workflow";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/server/actions/save-workflow", () => ({ saveWorkflowAction: vi.fn() }));
vi.mock("@xyflow/react", () => ({ ReactFlow: () => <div aria-label="测试画布" />, Background: () => null, Controls: () => null }));
const reviewId = "review-private", writerId = "writer-private";
beforeEach(() => {
  vi.clearAllMocks(); vi.mocked(saveWorkflowAction).mockReset(); window.sessionStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function draft(removable = false) {
  const raw = removable ? removableQualityGateRulesDraft() : qualityGateRulesDraft();
  const parsed = WorkflowDraft.parse(raw);
  return { ...parsed, originalRoot: raw.originalRoot, nodes: { ...parsed.nodes, [reviewId]: {
    ...parsed.nodes[reviewId], quality: raw.nodes[reviewId].quality, retry: raw.nodes[reviewId].retry,
    untouched: raw.nodes[reviewId].untouched,
  } } } as WorkflowDraft;
}
function canvas(workflow = draft()) {
  return { ...render(<FlowCanvas agentId={workflow.rootAgent.id} draft={workflow} draftUpdatedAt="2026-10-10T00:00:00.000Z" agentTargets={[]} toolOptions={[]} knowledgeSources={[]} />), workflow };
}
function select(id: string) { fireEvent.change(screen.getByRole("combobox", { name: "定位流程步骤" }), { target: { value: id } }); }
function open() {
  select(reviewId);
  const toggle = screen.getByRole("button", { name: /编辑交付质量规则|收起质量规则编辑/ });
  if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
  return within(screen.getByRole("region", { name: "交付前质量规则编辑" }));
}
function edit(value = "0") {
  const region = open(); fireEvent.click(region.getByRole("button", { name: /编辑质量规则|填写质量规则/ }));
  fireEvent.change(region.getByLabelText("最低有效结果数量"), { target: { value } }); return region;
}
function ask(region: ReturnType<typeof within>) { fireEvent.click(region.getByRole("button", { name: "应用质量规则到画布" })); }
function confirm() { fireEvent.click(screen.getByRole("button", { name: "确认应用质量规则" })); }
async function save() {
  vi.mocked(saveWorkflowAction).mockResolvedValue({ ok: true, updatedAt: "2026-10-10T00:00:01.000Z" });
  fireEvent.click(screen.getByRole("button", { name: "保存草稿" }));
  await waitFor(() => expect(saveWorkflowAction).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled());
  return vi.mocked(saveWorkflowAction).mock.calls[0][1];
}

describe("四项质量规则真实画布接线", () => {
  it("确认前不写稿，四项应用经历史和真实保存入口，只改质量且保留额外字段", async () => {
    const { workflow } = canvas(), region = edit("2");
    const storage = vi.spyOn(Storage.prototype, "setItem");
    fireEvent.click(region.getByLabelText("必须形成结果：参考资料"));
    fireEvent.click(region.getByLabelText("核对已执行工具的回执"));
    fireEvent.click(region.getByLabelText("核对已执行人工步骤的决定"));
    expect(screen.getByLabelText("未应用配置提醒")).toHaveTextContent("1 处");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    ask(region); expect(saveWorkflowAction).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled(); confirm();
    expect(screen.queryByLabelText("未应用配置提醒")).not.toBeInTheDocument();
    expect(region.getByRole("status")).toHaveTextContent("明确接收质量规则");
    const expectedQuality = { ...workflow.nodes[reviewId].quality, requiredOutputTitles: ["生成方案", "参考资料"], minOutputCount: 2, checkToolReceipts: false, checkHumanBoundary: false };
    fireEvent.click(screen.getByRole("button", { name: "撤销上一步修改" }));
    expect(screen.getByRole("region", { name: "交付前检查规则核对" })).toHaveTextContent("1 项");
    fireEvent.click(screen.getByRole("button", { name: "重做上一步修改" }));
    const saved = await save();
    expect(saved).toEqual({ ...workflow, nodes: { ...workflow.nodes, [reviewId]: { ...workflow.nodes[reviewId], quality: expectedQuality } } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("收起、切换与关闭详情后仍保留填写，取消只清本类且不保存", () => {
    canvas(); edit("0"); const storage = vi.spyOn(Storage.prototype, "setItem");
    fireEvent.click(screen.getByRole("button", { name: "收起质量规则编辑" }));
    expect(screen.queryByLabelText("最低有效结果数量")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑交付质量规则" }));
    expect(screen.getByLabelText("最低有效结果数量")).toHaveValue("0");
    select(writerId); open();
    expect(screen.getByLabelText("最低有效结果数量")).toHaveValue("0");
    fireEvent.click(screen.getAllByRole("button", { name: "关闭节点详情" })[0]); open();
    expect(screen.getByLabelText("最低有效结果数量")).toHaveValue("0");
    fireEvent.click(screen.getByRole("button", { name: "取消质量填写" }));
    expect(screen.queryByLabelText("未应用配置提醒")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    expect(saveWorkflowAction).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });

  it("确认取消保留四项填写；同值接收不制造撤销记录", () => {
    canvas(); const region = edit("1"); ask(region);
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "返回" }));
    expect(region.getByLabelText("最低有效结果数量")).toHaveValue("1");
    ask(region); confirm();
    expect(region.getByRole("status")).toHaveTextContent("明确接收");
    expect(screen.getByRole("button", { name: "撤销上一步修改" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    expect(saveWorkflowAction).not.toHaveBeenCalled();
  });

  it("真实父层输入来源语义校验失败，不清填写或显示成功", () => {
    const workflow = draft(); workflow.nodes[writerId].inputMapping = { fields: [{ target: ["金额"], source: { kind: "output", nodeId: "missing-source", path: [] }, required: true }], includeUpstreamOutputs: false };
    canvas(workflow); const region = edit(); ask(region); confirm();
    expect(region.getByLabelText("最低有效结果数量")).toHaveValue("0");
    expect(region.getByRole("alert")).toHaveTextContent("没有明确接受");
    expect(region.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByLabelText("未应用配置提醒")).toHaveTextContent("1 处");
    expect(saveWorkflowAction).not.toHaveBeenCalled();
  });

  it("当前画布A→B→A和局部同批次ABA均令旧确认失效", () => {
    canvas(); let region = edit(); ask(region);
    act(() => {
      fireEvent.change(screen.getByLabelText("节点名称"), { target: { value: "临时新标题" } });
      fireEvent.change(screen.getByLabelText("节点名称"), { target: { value: "核对交付" } });
    });
    confirm(); expect(region.getByLabelText("最低有效结果数量")).toHaveValue("0");
    expect(region.getByRole("button", { name: "应用质量规则到画布" })).toBeDisabled();
    fireEvent.click(region.getByRole("button", { name: "取消质量填写" })); region = edit(); ask(region);
    act(() => {
      fireEvent.change(region.getByLabelText("最低有效结果数量"), { target: { value: "1" } });
      fireEvent.change(region.getByLabelText("最低有效结果数量"), { target: { value: "0" } });
    });
    confirm(); expect(region.getByLabelText("最低有效结果数量")).toHaveValue("0");
    expect(region.getByRole("alert")).toHaveTextContent("原确认失效");
    expect(region.queryByRole("status")).not.toBeInTheDocument(); expect(saveWorkflowAction).not.toHaveBeenCalled();
  });

  it("接收质量后返工填写继续保留，不把另一类局部输入带进保存", async () => {
    const { workflow } = canvas(); select(writerId);
    await userEvent.click(screen.getByLabelText("当前步骤输入与结果约定"));
    const ai = within(screen.getByRole("region", { name: "智能处理自动返工上限" }));
    fireEvent.click(ai.getByRole("button", { name: "编辑返工上限" }));
    fireEvent.change(ai.getByLabelText("包含首次处理的总尝试次数"), { target: { value: "4" } });
    const region = edit(); expect(screen.getByLabelText("未应用配置提醒")).toHaveTextContent("2 处"); ask(region); confirm();
    expect(screen.getByLabelText("未应用配置提醒")).toHaveTextContent("1 处");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    select(writerId); await userEvent.click(screen.getByLabelText("当前步骤输入与结果约定"));
    expect(screen.getByLabelText("包含首次处理的总尝试次数")).toHaveValue("4");
    expect(screen.getByRole("button", { name: "应用到画布草稿" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "取消本页填写" }));
    const saved = await save();
    expect(saved).toEqual({ ...workflow, nodes: { ...workflow.nodes, [reviewId]: { ...workflow.nodes[reviewId], quality: { ...workflow.nodes[reviewId].quality, minOutputCount: 0 } } } });
  });

  it("移除单独确认，保留业务判断类别和等待，保存后不补回质量对象", async () => {
    const { workflow } = canvas(draft(true)), region = edit("0");
    expect(screen.queryByText(/此类业务规则由模型根据步骤说明判断/)).not.toBeInTheDocument();
    fireEvent.click(region.getByRole("button", { name: "移除质量规则并改走业务判断" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("下一次执行会按该类别调用模型");
    expect(saveWorkflowAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认移除并改走业务判断" }));
    expect(region.getByRole("status")).toHaveTextContent("下一次执行将按已有业务判断设置调用模型");
    expect(screen.getByText(/此类业务规则由模型根据步骤说明判断/)).toBeInTheDocument();
    const saved = await save(); const { quality, ...remaining } = workflow.nodes[reviewId]; expect(quality).toBeDefined();
    expect(saved).toEqual({ ...workflow, nodes: { ...workflow.nodes, [reviewId]: remaining } });
    expect(Object.hasOwn(saved.nodes[reviewId], "quality")).toBe(false); expect(fetch).not.toHaveBeenCalled();
  });

  it("没有真实画布memory或完整来源时只读，不伪造修订以开启编辑", () => {
    const workflow = draft(), change = vi.fn(() => true);
    const { rerender } = render(<NodeInspector node={workflow.nodes[reviewId]} workflow={workflow} qualitySourcesComplete onNodeChange={change} onNodeDelete={vi.fn()} />);
    expect(screen.getByText(/质量规则编辑暂不可用/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑交付质量规则" })).not.toBeInTheDocument();
    rerender(<NodeInspector node={workflow.nodes[reviewId]} workflowNodes={workflow.nodes} onNodeChange={change} onNodeDelete={vi.fn()} />);
    expect(screen.queryByRole("region", { name: "交付前质量规则编辑" })).not.toBeInTheDocument(); expect(change).not.toHaveBeenCalled();
  });
});

describe("质量字段边界与显示隐私", () => {
  it("通用提交只复制质量，不夹带返工或输入；拒绝普通节点与组内规则", () => {
    const workflow = draft(), node = workflow.nodes[reviewId];
    const result = applyTopLevelNodeContract(workflow, node, { ...node, quality: { ...node.quality!, minOutputCount: 0 }, retry: { maxAttempts: 8, backoffMs: 60000 } }, "quality");
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.node.retry).toEqual(node.retry); expect(result.node.quality?.minOutputCount).toBe(0); }
    expect(applyTopLevelNodeContract(workflow, workflow.nodes[writerId], { ...workflow.nodes[writerId], quality: node.quality }, "quality").ok).toBe(false);
    const group = nodeContractWorkflow(), parent = group.nodes.group, current = readInlineContractNode(parent, { stepIndex: 0 });
    if (!current.ok) throw new Error(current.error);
    expect(applyInlineNodeContract(group, parent, { stepIndex: 0 }, current.node, { ...current.node, quality: node.quality }, "quality").ok).toBe(false);
    const { quality, ...without } = node; expect(quality).toBeDefined();
    expect(applyTopLevelNodeContract(workflow, node, without, "quality").ok).toBe(false);
  });

  it("只隐藏显示中的实际内部标识，选中来源及请求仍保留完整实际标题", () => {
    const workflow = draft(); const title = writerId + " · 生成方案";
    workflow.nodes[writerId] = { ...workflow.nodes[writerId], title };
    workflow.nodes[reviewId] = { ...workflow.nodes[reviewId], title: reviewId + " · 核对交付", quality: { ...workflow.nodes[reviewId].quality!, requiredOutputTitles: [title] } };
    const apply = vi.fn((request: QualityGateRulesRequest) => acceptQualityGateRulesRequest(workflow, 1, reviewId, true, request).ok);
    const { container } = render(<QualityGateRulesEditor canvasDraft={workflow} nodeId={reviewId} revision={1} sourcesComplete onApply={apply} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑质量规则" }));
    expect(container.textContent).not.toMatch(/review-private|writer-private|00000000-0000-4000-8000-0000000000d1/);
    fireEvent.click(screen.getByRole("button", { name: "应用质量规则到画布" })); confirm();
    expect(apply).toHaveBeenCalledOnce(); const request = apply.mock.calls[0][0];
    if (request.action !== "apply") throw new Error("Expected quality input");
    expect(request.input.requiredOutputTitles).toEqual([title]);
    expect(workflow.nodes[reviewId].quality?.requiredOutputTitles).toEqual([title]);
  });

  it("显示核对不读取访问器，也不就地改写草稿", () => {
    const workflow = draft(), before = JSON.stringify(workflow); const display = qualityDisplay(workflow);
    expect(display(workflow.rootAgent.id)).toBe("[内部标识已隐藏]"); expect(JSON.stringify(workflow)).toBe(before);
    let reads = 0;
    const unsafe = Object.defineProperty({}, "nodes", { enumerable: true, get: () => { reads += 1; return workflow.nodes; } });
    qualityDisplay(unsafe, reviewId)(reviewId); expect(reads).toBe(0);
  });
});
