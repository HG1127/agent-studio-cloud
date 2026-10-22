import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NodeChange } from "@xyflow/react";
import { describe, expect, it, vi } from "vitest";
import { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { FrozenWorkflowViewer } from "@/features/versions/FrozenWorkflowViewer";
import { frozenWorkflowView } from "@/features/versions/frozen-workflow-view";
import { frozenDraft, frozenManifest } from "../fixtures/frozen-version";
import { collaborationDraft } from "../fixtures/workflow-collaborations";

const flow = vi.hoisted(() => ({ props: null as Record<string, unknown> | null, setCenter: vi.fn(), fitView: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn() }));
vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: Record<string, unknown>) => {
    flow.props = props;
    (props.onInit as (instance: unknown) => void)(flow);
    return <div data-testid="frozen-flow"><button type="button" onClick={() => (props.onNodeClick as (event: unknown, node: unknown) => void)({}, { id: "compose" })}>画布选择测试步骤</button><button type="button" onClick={() => (props.onPaneClick as () => void)()}>画布取消选择</button></div>;
  }, Background: () => null, Handle: () => null, Position: { Left: "left", Right: "right" },
}));
function view(workflow = frozenWorkflowView(frozenDraft)) {
  return <FrozenWorkflowViewer workflow={workflow} input={frozenManifest.inputContract} output={frozenManifest.outputContract} />;
}
describe("冻结流程只读工作台", () => {
  it("内部默认处理标记只保留在开发者数据，不成为业务英文文案", () => {
    const workflow = frozenWorkflowView(WorkflowDraft.parse({ ...frozenDraft, startNodeId: "compose",
      nodes: { ...frozenDraft.nodes, compose: { ...frozenDraft.nodes.compose, purpose: "execute" } } }));
    render(view(workflow));
    expect(screen.getByText("处理要求为通用标记，详见下方开发者设置。")).toBeInTheDocument();
    expect(screen.queryByText("处理要求：execute")).not.toBeInTheDocument();
    expect(screen.getByLabelText("冻结步骤设置内容")).toHaveTextContent('"purpose": "execute"');
    expect(workflow.nodes.compose.purpose).toBe("execute");
  });
  it("没有编辑运行入口，真实系统检查也在列表和画布，不传入写处理器", () => {
    const workflow = frozenWorkflowView(frozenDraft);
    const original = JSON.stringify(workflow);
    render(view(workflow));
    expect(screen.getByText(/保存 5 个顶层步骤，包含 1 个系统检查步骤/)).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "冻结步骤列表" })).getByRole("button", { name: /已冻结结果检查/ })).toBeInTheDocument();
    expect(flow.props).toMatchObject({ nodesDraggable: false, nodesConnectable: false, edgesReconnectable: false, deleteKeyCode: null, connectOnClick: false });
    expect(flow.props?.onConnect).toBeUndefined();
    const onNodesChange = flow.props?.onNodesChange as (changes: NodeChange[]) => void;
    expect(onNodesChange).toBeTypeOf("function");
    expect(flow.props?.onEdgesChange).toBeUndefined();
    expect(screen.queryByRole("button", { name: /保存|发布|开始.*运行|删除/ })).not.toBeInTheDocument();
    const originalGraph = JSON.stringify({ nodes: flow.props?.nodes, edges: flow.props?.edges });
    const originalEdges = JSON.stringify(flow.props?.edges);
    const nodeStructure = () => JSON.stringify((flow.props?.nodes as Record<string, unknown>[]).map((node) => {
      const { selected, ...saved } = node;
      void selected;
      return saved;
    }));
    const originalNodes = nodeStructure();
    const replacement = { id: "compose", position: { x: 4000, y: 4000 }, data: { title: "不可写入的内容" } };
    const writes: NodeChange[] = [
      { type: "position", id: "compose", position: { x: 4000, y: 4000 }, dragging: true },
      { type: "dimensions", id: "compose", dimensions: { width: 999, height: 999 }, setAttributes: true },
      { type: "remove", id: "start" },
      { type: "add", item: { ...replacement, id: "added" } },
      { type: "replace", id: "compose", item: replacement },
    ];
    act(() => onNodesChange(writes));
    expect(JSON.stringify({ nodes: flow.props?.nodes, edges: flow.props?.edges })).toBe(originalGraph);
    expect(screen.getByRole("heading", { name: "收到客户任务" })).toBeInTheDocument();
    act(() => onNodesChange([...writes, { type: "select", id: "compose", selected: true }]));
    expect(screen.getByRole("heading", { name: "冻结的回复方案" })).toBeInTheDocument();
    expect(flow.props?.nodes).toHaveLength(5);
    expect(nodeStructure()).toBe(originalNodes);
    expect(JSON.stringify(flow.props?.edges)).toBe(originalEdges);
    act(() => onNodesChange([{ type: "select", id: "missing", selected: true }]));
    expect(screen.getByRole("heading", { name: "冻结的回复方案" })).toBeInTheDocument();
    act(() => onNodesChange([{ type: "select", id: "compose", selected: false }]));
    expect(screen.getByRole("status")).toHaveTextContent("从只读画布或步骤列表");
    expect(nodeStructure()).toBe(originalNodes);
    expect(JSON.stringify(flow.props?.edges)).toBe(originalEdges);
    expect(JSON.stringify(workflow)).toBe(original);
  });
  it("查找只缩小列表，不隐藏图或清空已选设置，清除返回真实清单", async () => {
    render(view());
    const user = userEvent.setup();
    const search = screen.getByRole("searchbox", { name: "按保存的名称或说明查找" });
    await user.type(search, "冻结的回复");
    const list = screen.getByRole("list", { name: "冻结步骤列表" });
    expect(within(list).getAllByRole("button")).toHaveLength(1);
    expect(flow.props?.nodes).toHaveLength(5);
    expect(screen.getByRole("heading", { name: "收到客户任务" })).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "不存在的名字");
    expect(screen.getByRole("status")).toHaveTextContent("不表示流程为空");
    await user.click(screen.getByRole("button", { name: "清除步骤查找" }));
    expect(within(screen.getByRole("list", { name: "冻结步骤列表" })).getAllByRole("button")).toHaveLength(5);
  });
  it("原生列表键盘选择保留按钮焦点，路径定位聚焦实际目标标题", async () => {
    render(view());
    const user = userEvent.setup();
    const button = within(screen.getByRole("list", { name: "冻结步骤列表" })).getByRole("button", { name: /冻结的回复方案/ });
    button.focus();
    await user.keyboard("{Enter}");
    expect(button).toHaveFocus();
    expect(screen.getByRole("heading", { name: "冻结的回复方案" })).toBeInTheDocument();
    expect(screen.getByText("处理要求：[已隐藏敏感信息]")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "冻结的回复方案" })).not.toHaveTextContent("private-frozen-secret-2026");
    await user.click(within(screen.getByRole("region", { name: "冻结的回复方案" })).getByRole("button", { name: "负责人确认" }));
    expect(screen.getByRole("heading", { name: "负责人确认" })).toHaveFocus();
    expect(screen.getByText("确认角色：业务负责人")).toBeInTheDocument();
    expect(flow.setCenter).toHaveBeenCalled();
  });
  it("整理、返回快照坐标和缩放仅调用查看能力，来源不变", async () => {
    const original = JSON.stringify(frozenDraft);
    render(view());
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "整理查看布局" }));
    expect(screen.getByRole("button", { name: "返回快照布局" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "返回快照布局" }));
    await user.click(screen.getByRole("button", { name: "适应画布" }));
    await user.click(screen.getByRole("button", { name: "放大只读画布" }));
    await user.click(screen.getByRole("button", { name: "缩小只读画布" }));
    expect(flow.fitView).toHaveBeenCalled();
    expect(flow.zoomIn).toHaveBeenCalled();
    expect(flow.zoomOut).toHaveBeenCalled();
    expect(JSON.stringify(frozenDraft)).toBe(original);
  });
  it("没有位置不声称保存布局，起点和失效目标不自修", () => {
    const draft = WorkflowDraft.parse({ ...frozenDraft, startNodeId: "missing", ui: { positions: {} }, nodes: { ...frozenDraft.nodes, compose: { ...frozenDraft.nodes.compose, next: "missing" } } });
    render(view(frozenWorkflowView(draft)));
    expect(screen.getByLabelText("快照布局说明")).toHaveTextContent("没有保存的步骤位置");
    expect(screen.queryByRole("button", { name: "没有保存的步骤位置" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "整理查看布局" })).not.toBeInTheDocument();
    expect(screen.getByText(/按已保存路径临时计算布局，不写入坐标/)).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(screen.getByText(/没有找到已保存的流程起点/)).toBeInTheDocument();
    expect(screen.getByText(/有 1 条已保存路径未找到目标步骤/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("选择一项");
  });
  it("空快照不拿当前草稿补造，空字段不生成输入和交付", () => {
    render(<FrozenWorkflowViewer workflow={WorkflowDraft.parse({ ...frozenDraft, nodes: {} })} input={{ fields: [] }} output={undefined} />);
    expect(screen.queryByTestId("frozen-flow")).not.toBeInTheDocument();
    expect(screen.getByText(/没有保存顶层步骤/)).toBeInTheDocument();
    expect(screen.getByText(/没有保存结构化输入字段/)).toBeInTheDocument();
    expect(screen.getByText(/没有保存结构化交付字段/)).toBeInTheDocument();
  });
  it("继承属性不是冻结起点、后续目标或交付来源，未知角色不会冒充角色名称", async () => {
    const workflow = frozenWorkflowView(WorkflowDraft.parse({ ...frozenDraft, startNodeId: "constructor",
      nodes: { ...frozenDraft.nodes, compose: { ...frozenDraft.nodes.compose, next: "__proto__" },
        approve: { ...frozenDraft.nodes.approve, approval: { role: "constructor", reason: "核对说明" } } } }));
    render(<FrozenWorkflowViewer workflow={workflow} input={{ fields: [] }}
      output={{ fields: [{ path: "result", sourceNodeId: "constructor", required: true }] }} />);
    expect(screen.getByRole("status")).toHaveTextContent("选择一项");
    expect(screen.getByText(/没有找到已保存的流程起点/)).toBeInTheDocument();
    expect(screen.getByText(/有 1 条已保存路径未找到目标步骤/)).toBeInTheDocument();
    expect(screen.getByText("已保存来源关联，但未找到对应步骤。")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /定位来源/ })).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(within(screen.getByRole("list", { name: "冻结步骤列表" })).getByRole("button", { name: /冻结的回复方案/ }));
    expect(screen.getByText("关联步骤未找到")).toBeInTheDocument();
    await user.click(within(screen.getByRole("list", { name: "冻结步骤列表" })).getByRole("button", { name: /负责人确认/ }));
    expect(screen.getByText("确认角色：已配置角色，详见开发者设置")).toBeInTheDocument();
  });
  it("交付来源按显式关联定位、聚焦，缺失关联不从内部路径猜测", async () => {
    render(view());
    await userEvent.click(screen.getByRole("button", { name: "定位来源：冻结的回复方案" }));
    expect(screen.getByRole("heading", { name: "冻结的回复方案" })).toHaveFocus();
    const region = screen.getByRole("region", { name: "冻结的最终交付约定" });
    expect(region).not.toHaveTextContent("privateOutput");
    expect(screen.getByRole("region", { name: "冻结的业务输入约定" })).not.toHaveTextContent("privateBusinessInput");
    expect(screen.getByText("输入 2")).toBeInTheDocument();
  });
  it("开发者设置复制实际脱敏节点，改变选择后复制反馈重置", async () => {
    const user = userEvent.setup();
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: write } });
    render(view());
    await user.click(within(screen.getByRole("list", { name: "冻结步骤列表" })).getByRole("button", { name: /冻结的回复方案/ }));
    await user.click(screen.getByText("查看脱敏步骤设置（开发者数据）"));
    await user.click(screen.getByRole("button", { name: "复制脱敏步骤设置" }));
    const expected = frozenWorkflowView(frozenDraft).nodes.compose;
    expect(write).toHaveBeenCalledWith(JSON.stringify(expected, null, 2));
    expect(screen.getByRole("status")).toHaveTextContent("已复制");
    await user.click(within(screen.getByRole("list", { name: "冻结步骤列表" })).getByRole("button", { name: /负责人确认/ }));
    expect(screen.queryByText("已复制")).not.toBeInTheDocument();
  });
  it("冻结协作目标与交接约定保留，组内名称显示但不冒充顶层图", async () => {
    render(view(frozenWorkflowView(collaborationDraft)));
    const user = userEvent.setup();
    const list = screen.getByRole("list", { name: "冻结步骤列表" });
    await user.click(within(list).getByRole("button", { name: /交付给研究助手/ }));
    expect(screen.getByText(/已冻结协作目标：研究助手/)).toBeInTheDocument();
    await user.click(screen.getByText("核对已冻结交接约定"));
    expect(screen.getByText("必须交付")).toBeInTheDocument();
    expect(screen.getByText("禁止带入")).toBeInTheDocument();
    expect(screen.getByText("分析结论")).toBeInTheDocument();
    expect(screen.getByText(/传入说明 · 文字 · 必须提供/)).toBeInTheDocument();
    expect(screen.getByText(/不传入经验/)).toBeInTheDocument();
    await user.click(within(list).getByRole("button", { name: /交付准备/ }));
    await user.click(screen.getByText("准备 · 1 项"));
    expect(screen.getByText("1 · 组内交接")).toBeInTheDocument();
    expect(within(list).queryByRole("button", { name: /组内交接/ })).not.toBeInTheDocument();
  });
  it("未保存组内名称不显示内部步骤标识，关联目标缺失仍保留设置", async () => {
    const group = WorkflowNode.parse({ id: "group", title: "冻结步骤组", type: "subflow", subflow: { name: "保存的组", steps: [{ id: "secret-node", type: "ai" }] }, next: "unknown" });
    const draft = WorkflowDraft.parse({ ...frozenDraft, startNodeId: "group", nodes: { group }, ui: { positions: {} } });
    render(view(frozenWorkflowView(draft)));
    await userEvent.click(screen.getByText("保存的组 · 1 项"));
    expect(screen.getByText("1 · 未保存步骤名称")).toBeInTheDocument();
    expect(screen.getByText("关联步骤未找到")).toBeInTheDocument();
    expect(screen.queryByText("secret-node")).not.toBeInTheDocument();
  });
  it("画布选择与取消只改变查看目标", () => {
    render(view());
    fireEvent.click(screen.getByRole("button", { name: "画布选择测试步骤" }));
    expect(screen.getByRole("heading", { name: "冻结的回复方案" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "画布取消选择" }));
    expect(screen.getByRole("status")).toHaveTextContent("从只读画布或步骤列表");
  });
});
