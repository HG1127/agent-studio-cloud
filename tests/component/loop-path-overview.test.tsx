import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowNode, type WorkflowDraft } from "@/contracts/workflow";
import { LoopPathOverview } from "@/features/workflow-canvas/LoopPathOverview";

const LOOP = "private_loop";
const FIRST = "private_first";
const SECOND = "private_second";
const EXIT = "private_exit";
const fetchRequest = vi.fn();
function graph(): WorkflowDraft["nodes"] {
  return {
    [LOOP]: WorkflowNode.parse({ id: LOOP, title: "逐项核对资料", type: "loop", loop: { collectionPath: "input.items", itemKey: "item", maxIterations: 10, bodyNext: FIRST, exitNext: EXIT } }),
    [FIRST]: WorkflowNode.parse({ id: FIRST, title: "读取本项资料", type: "ai", next: SECOND }),
    [SECOND]: WorkflowNode.parse({ id: SECOND, title: "整理本项内容", type: "system", next: LOOP }),
    [EXIT]: WorkflowNode.parse({ id: EXIT, title: "循环后的汇总", type: "end" }),
  };
}
function panel() { return screen.getByRole("region", { name: "循环内直接路径" }); }
beforeEach(() => { fetchRequest.mockReset(); vi.stubGlobal("fetch", fetchRequest); });
afterEach(() => { expect(fetchRequest).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("真实循环路径叶子组件（作者规格，未执行）", () => {
  it("草稿查看只展示顺序与限定，手动定位调用已有回调，不改流程或自动定位", () => {
    const nodes = graph(); const original = structuredClone(nodes); const focus = vi.fn();
    render(<LoopPathOverview nodeId={LOOP} nodes={nodes} onFocusNode={focus} />);
    const list = within(panel()).getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(panel()).getByText(/当前草稿：/)).toHaveTextContent("不代表已保存、已发布或实际执行");
    expect(within(panel()).getByRole("status")).toHaveTextContent("是否进入下一项由实际运行决定");
    expect(focus).not.toHaveBeenCalled();
    fireEvent.click(within(list).getByRole("button", { name: "整理本项内容 · 定位步骤" }));
    expect(focus).toHaveBeenCalledExactlyOnceWith(SECOND); expect(nodes).toEqual(original);
    for (const id of [LOOP, FIRST, SECOND, EXIT]) expect(panel()).not.toHaveTextContent(id);
    expect(panel()).not.toHaveTextContent("input.items");
    expect(within(panel()).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(panel()).queryByRole("button", { name: /保存|运行|删除/ })).not.toBeInTheDocument();
  });

  it("冻结模式仅定位此版本中的名称，不误称可编辑版本或步骤已执行", () => {
    const nodes = graph(); const original = structuredClone(nodes); const focus = vi.fn();
    render(<LoopPathOverview nodeId={LOOP} nodes={nodes} mode="frozen" onFocusNode={focus} />);
    expect(within(panel()).getByText(/冻结定义：/)).toHaveTextContent("不修改该版本或当前草稿");
    expect(within(panel()).getByText(/冻结定义：/)).toHaveTextContent("不表示这些步骤已执行");
    expect(within(panel()).queryByText(/当前草稿：/)).not.toBeInTheDocument();
    fireEvent.click(within(panel()).getByRole("button", { name: "读取本项资料 · 定位步骤" }));
    expect(focus).toHaveBeenCalledExactlyOnceWith(FIRST); expect(nodes).toEqual(original);
  });

  it("没有定位回调时只列真实名称，不制造可点击动作", () => {
    render(<LoopPathOverview nodeId={LOOP} nodes={graph()} mode="frozen" />);
    expect(within(panel()).getByText("读取本项资料")).toBeVisible();
    expect(within(panel()).queryByRole("button")).not.toBeInTheDocument();
    expect(within(panel()).getByText(/没有可用的步骤定位入口/)).toBeVisible();
  });

  it("缺失起点或记录不对应明确保持未知，不显示原引用、假空状态或定位按钮", () => {
    const nodes = graph(); nodes[LOOP] = { ...nodes[LOOP], loop: { ...nodes[LOOP].loop!, bodyNext: "private_unknown_reference" } };
    const focus = vi.fn(); const view = render(<LoopPathOverview nodeId={LOOP} nodes={nodes} onFocusNode={focus} />);
    expect(within(panel()).getByRole("status")).toHaveTextContent("下一关联步骤尚未读到");
    expect(within(panel()).queryByRole("list")).not.toBeInTheDocument();
    expect(within(panel()).queryByRole("button")).not.toBeInTheDocument();
    expect(panel()).not.toHaveTextContent("private_unknown_reference");
    view.rerender(<LoopPathOverview nodeId={LOOP} nodes={{}} mode="frozen" onFocusNode={focus} />);
    expect(within(panel()).getByRole("status")).toHaveTextContent("不是没有内部步骤的结论");
    expect(focus).not.toHaveBeenCalled();
  });

  it("遇分支只列可核对的边界步骤，明确停止且不显示猜选的后续路径", () => {
    const nodes = graph(); nodes[FIRST] = WorkflowNode.parse({ ...nodes[FIRST], type: "condition", condition: { source: "input.choice", branches: [{ label: "情况一", next: SECOND }], defaultNext: EXIT } });
    const focus = vi.fn(); render(<LoopPathOverview nodeId={LOOP} nodes={nodes} onFocusNode={focus} />);
    expect(within(panel()).getAllByRole("button")).toHaveLength(1);
    expect(within(panel()).getByRole("status")).toHaveTextContent("未选择或猜测其中的分支");
    expect(within(panel()).queryByText(/整理本项内容/)).not.toBeInTheDocument();
    fireEvent.click(within(panel()).getByRole("button", { name: "读取本项资料 · 定位步骤" }));
    expect(focus).toHaveBeenCalledExactlyOnceWith(FIRST);
  });

  it("同ID或未保存标题使用安全中文名称，定位仍指向真实已核对步骤", () => {
    const nodes = graph(); nodes[FIRST] = { ...nodes[FIRST], title: FIRST }; nodes[SECOND] = { ...nodes[SECOND], title: "" };
    const focus = vi.fn(); render(<LoopPathOverview nodeId={LOOP} nodes={nodes} onFocusNode={focus} />);
    expect(within(panel()).getByRole("button", { name: "处理步骤 1（名称待核对） · 定位步骤" })).toBeEnabled();
    fireEvent.click(within(panel()).getByRole("button", { name: "处理步骤 2（名称待核对） · 定位步骤" }));
    expect(focus).toHaveBeenCalledExactlyOnceWith(SECOND);
    for (const id of [LOOP, FIRST, SECOND, EXIT]) expect(panel()).not.toHaveTextContent(id);
  });

  it("定义或模式重渲染不自动定位；名称相同但步骤不同只定位当前定义", () => {
    const nodes = graph(); const focus = vi.fn(); const view = render(<LoopPathOverview nodeId={LOOP} nodes={nodes} onFocusNode={focus} />);
    const nextNodes = graph(); const nextId = "private_new_first";
    nextNodes[LOOP] = { ...nextNodes[LOOP], loop: { ...nextNodes[LOOP].loop!, bodyNext: nextId } };
    nextNodes[nextId] = { ...nextNodes[FIRST], id: nextId }; delete nextNodes[FIRST];
    view.rerender(<LoopPathOverview nodeId={LOOP} nodes={nextNodes} mode="frozen" onFocusNode={focus} />);
    expect(focus).not.toHaveBeenCalled();
    fireEvent.click(within(panel()).getByRole("button", { name: "读取本项资料 · 定位步骤" }));
    expect(focus).toHaveBeenCalledExactlyOnceWith(nextId);
    expect(nodes).toEqual(graph());
  });
});
