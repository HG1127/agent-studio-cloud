import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { NodeInspector } from "@/features/workflow-canvas/NodeInspector";
import { FrozenNodeDetails } from "@/features/versions/FrozenNodeDetails";

const io = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/server/actions/save-workflow", () => ({ saveWorkflowAction: io.save }));
const request = vi.fn<typeof fetch>();
const LOOP = "private_loop";
const FIRST = "private_first";
const SECOND = "private_second";
const EXIT = "private_exit";
const START = "private_start";
const MISSING = "private_unknown_reference";

function definition(nodeOverrides: WorkflowDraft["nodes"] = {}, versionId: string | null = null) {
  return WorkflowDraft.parse({
    id: "private_workflow", versionId, startNodeId: START,
    rootAgent: { id: "40000000-0000-4000-8000-000000000001", name: "逐项资料核对助手", role: "业务助手" },
    memoryPolicy: { taskContext: true, longTerm: false }, variables: [],
    nodes: {
      [START]: WorkflowNode.parse({ id: START, title: "开始核对", type: "trigger", next: LOOP }),
      [LOOP]: WorkflowNode.parse({ id: LOOP, title: "逐项核对资料", type: "loop", loop: { collectionPath: "input.items", itemKey: "item", maxIterations: 10, bodyNext: FIRST, exitNext: EXIT } }),
      [FIRST]: WorkflowNode.parse({ id: FIRST, title: "读取本项资料", type: "ai", next: SECOND }),
      [SECOND]: WorkflowNode.parse({ id: SECOND, title: "整理本项内容", type: "system", next: LOOP }),
      [EXIT]: WorkflowNode.parse({ id: EXIT, title: "循环后的汇总", type: "end" }),
      ...nodeOverrides,
    },
  });
}
function editor(workflow: WorkflowDraft, focus = vi.fn(), change = vi.fn()) {
  const deleteNode = vi.fn(); const route = vi.fn(); const disconnect = vi.fn(); const reveal = vi.fn();
  return { focus, change, deleteNode, route, disconnect, reveal, element: <NodeInspector node={workflow.nodes[LOOP]} workflow={workflow} workflowNodes={workflow.nodes}
    onNodeChange={change} onNodeDelete={deleteNode} onFocusNode={focus} onRouteChange={route} onDisconnectIncoming={disconnect} onRevealControlNodes={reveal} /> };
}
function pathPanel() { return screen.getByRole("region", { name: "循环内直接路径" }); }
function privateIdsAbsent(panel: HTMLElement) {
  for (const id of [LOOP, FIRST, SECOND, EXIT, START, MISSING, "private_workflow"]) expect(panel).not.toHaveTextContent(id);
}
beforeEach(() => {
  io.save.mockReset().mockResolvedValue({ ok: false, error: "此只读定位规格不得触发保存" });
  request.mockReset().mockRejectedValue(new Error("只读路径查看不应请求网络"));
  vi.stubGlobal("fetch", request);
});
afterEach(() => {
  cleanup(); expect(io.save).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled(); vi.unstubAllGlobals();
});

describe("真实编辑/冻结父组件→真实循环路径叶子（source-only，未执行；不证明FlowCanvas或原生画布接线）", () => {
  it("真实NodeInspector内部展示已有步骤名称，手动定位只调用定位回调，不修改或保存草稿", () => {
    const workflow = definition(); const original = structuredClone(workflow); const parent = editor(workflow);
    render(parent.element);
    expect(screen.getByRole("complementary", { name: "节点详情" })).toContainElement(pathPanel());
    expect(within(pathPanel()).getByText(/当前草稿：/)).toHaveTextContent("不代表已保存、已发布或实际执行");
    expect(within(pathPanel()).queryByText(/冻结定义：/)).not.toBeInTheDocument();
    expect(within(pathPanel()).getByText("展开每项的直接处理路径").closest("details")).toHaveAttribute("open");
    expect(within(pathPanel()).getAllByRole("listitem")).toHaveLength(2);
    expect(within(pathPanel()).getByRole("status")).toHaveTextContent("是否进入下一项由实际运行决定");
    expect(parent.focus).not.toHaveBeenCalled();
    fireEvent.click(within(pathPanel()).getByRole("button", { name: "整理本项内容 · 定位步骤" }));
    expect(parent.focus).toHaveBeenCalledExactlyOnceWith(SECOND);
    for (const write of [parent.change, parent.deleteNode, parent.route, parent.disconnect, parent.reveal]) expect(write).not.toHaveBeenCalled();
    expect(workflow).toEqual(original); privateIdsAbsent(pathPanel());
  });

  it("真实FrozenNodeDetails使用冻结限定且只定位此版本，不回落至同时挂载的草稿父页", () => {
    const draft = definition({ [SECOND]: WorkflowNode.parse({ id: SECOND, title: "草稿内整理资料", type: "system", next: LOOP }) });
    const frozen = definition({ [SECOND]: WorkflowNode.parse({ id: SECOND, title: "冻结内整理资料", type: "system", next: LOOP }) }, "40000000-0000-4000-8000-000000000002");
    const originalDraft = structuredClone(draft); const originalFrozen = structuredClone(frozen);
    const editable = editor(draft); const selectFrozen = vi.fn();
    render(<><section aria-label="草稿父组件">{editable.element}</section><section aria-label="冻结父组件"><FrozenNodeDetails node={frozen.nodes[LOOP]} workflow={frozen} onSelect={selectFrozen} /></section></>);
    const draftPath = within(screen.getByRole("region", { name: "草稿父组件" })).getByRole("region", { name: "循环内直接路径" });
    const frozenPath = within(screen.getByRole("region", { name: "冻结父组件" })).getByRole("region", { name: "循环内直接路径" });
    expect(within(draftPath).getByText(/当前草稿：/)).toBeVisible();
    expect(within(frozenPath).getByText(/冻结定义：/)).toHaveTextContent("不修改该版本或当前草稿");
    expect(within(frozenPath).getByText(/冻结定义：/)).toHaveTextContent("不表示这些步骤已执行");
    expect(within(frozenPath).queryByText(/当前草稿：/)).not.toBeInTheDocument();
    expect(within(frozenPath).queryByText(/草稿内整理资料/)).not.toBeInTheDocument();
    fireEvent.click(within(frozenPath).getByRole("button", { name: "冻结内整理资料 · 定位步骤" }));
    expect(selectFrozen).toHaveBeenCalledExactlyOnceWith(SECOND); expect(editable.focus).not.toHaveBeenCalled();
    for (const write of [editable.change, editable.deleteNode, editable.route, editable.disconnect, editable.reveal]) expect(write).not.toHaveBeenCalled();
    expect(draft).toEqual(originalDraft); expect(frozen).toEqual(originalFrozen);
    privateIdsAbsent(draftPath); privateIdsAbsent(frozenPath);
  });

  it.each(["draft", "frozen"] as const)("真实%s父组件遇到分支只展示已核对边界名称，不猜选后续路径", (mode) => {
    const workflow = definition({ [FIRST]: WorkflowNode.parse({ id: FIRST, title: "判断本项处理方式", type: "condition", next: SECOND, condition: { source: "input.choice", operator: "eq", branches: [{ label: "情况一", value: "是", next: SECOND }], defaultNext: EXIT } }) });
    const original = structuredClone(workflow); const select = vi.fn(); const change = vi.fn(); const parent = editor(workflow, select, change);
    render(mode === "draft" ? parent.element : <FrozenNodeDetails node={workflow.nodes[LOOP]} workflow={workflow} onSelect={select} />);
    expect(within(pathPanel()).getByRole("status")).toHaveTextContent("未选择或猜测其中的分支");
    expect(within(pathPanel()).getAllByRole("button")).toHaveLength(1);
    expect(within(pathPanel()).queryByText(/整理本项内容/)).not.toBeInTheDocument();
    fireEvent.click(within(pathPanel()).getByRole("button", { name: "判断本项处理方式 · 定位步骤" }));
    expect(select).toHaveBeenCalledExactlyOnceWith(FIRST); expect(change).not.toHaveBeenCalled();
    expect(workflow).toEqual(original); privateIdsAbsent(pathPanel());
  });

  it.each(["draft", "frozen"] as const)("真实%s父组件关联步骤缺失时保持未知，不制造空完成结论或可点击目标", (mode) => {
    const workflow = definition({ [LOOP]: WorkflowNode.parse({ id: LOOP, title: "逐项核对资料", type: "loop", loop: { collectionPath: "input.items", itemKey: "item", maxIterations: 10, bodyNext: MISSING, exitNext: EXIT } }) });
    const original = structuredClone(workflow); const select = vi.fn(); const change = vi.fn(); const parent = editor(workflow, select, change);
    render(mode === "draft" ? parent.element : <FrozenNodeDetails node={workflow.nodes[LOOP]} workflow={workflow} onSelect={select} />);
    expect(within(pathPanel()).getByRole("status")).toHaveTextContent("下一关联步骤尚未读到");
    expect(within(pathPanel()).queryByRole("list")).not.toBeInTheDocument();
    expect(within(pathPanel()).queryByRole("button")).not.toBeInTheDocument();
    expect(pathPanel()).not.toHaveTextContent("全部完成"); expect(pathPanel()).not.toHaveTextContent("没有内部步骤");
    expect(select).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled();
    expect(workflow).toEqual(original); privateIdsAbsent(pathPanel());
  });

  it.each(["draft", "frozen"] as const)("真实%s父内新增路径区块隐藏同ID及未保存标题，仍只定位已核对步骤", (mode) => {
    const workflow = definition({ [FIRST]: WorkflowNode.parse({ id: FIRST, title: FIRST, type: "ai", next: SECOND }), [SECOND]: WorkflowNode.parse({ id: SECOND, title: "", type: "system", next: LOOP }) });
    const original = structuredClone(workflow); const select = vi.fn(); const change = vi.fn(); const parent = editor(workflow, select, change);
    render(mode === "draft" ? parent.element : <FrozenNodeDetails node={workflow.nodes[LOOP]} workflow={workflow} onSelect={select} />);
    expect(within(pathPanel()).getByRole("button", { name: "处理步骤 1（名称待核对） · 定位步骤" })).toBeVisible();
    fireEvent.click(within(pathPanel()).getByRole("button", { name: "处理步骤 2（名称待核对） · 定位步骤" }));
    expect(select).toHaveBeenCalledExactlyOnceWith(SECOND); expect(change).not.toHaveBeenCalled();
    expect(workflow).toEqual(original); privateIdsAbsent(pathPanel());
  });

  it("编辑父页未提供定位回调时只显示名称，冻结父页点击仍不创建草稿或触发保存", () => {
    const workflow = definition(); const original = structuredClone(workflow); const change = vi.fn(); const deleteNode = vi.fn();
    const view = render(<NodeInspector node={workflow.nodes[LOOP]} workflow={workflow} workflowNodes={workflow.nodes} onNodeChange={change} onNodeDelete={deleteNode} />);
    expect(within(pathPanel()).getByText("读取本项资料")).toBeVisible();
    expect(within(pathPanel()).queryByRole("button")).not.toBeInTheDocument();
    expect(within(pathPanel()).getByText(/没有可用的步骤定位入口/)).toBeVisible();
    const frozen = definition({}, "40000000-0000-4000-8000-000000000002"); const originalFrozen = structuredClone(frozen); const select = vi.fn();
    view.rerender(<FrozenNodeDetails node={frozen.nodes[LOOP]} workflow={frozen} onSelect={select} />);
    fireEvent.click(within(pathPanel()).getByRole("button", { name: "读取本项资料 · 定位步骤" }));
    expect(select).toHaveBeenCalledExactlyOnceWith(FIRST); expect(change).not.toHaveBeenCalled(); expect(deleteNode).not.toHaveBeenCalled();
    expect(workflow).toEqual(original); expect(frozen).toEqual(originalFrozen);
  });
});
