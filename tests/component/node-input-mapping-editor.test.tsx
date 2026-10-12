import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { NodeInputMappingEditor } from "@/features/workflow-canvas/NodeInputMappingEditor";

const onNodeChange = vi.fn();
function flow() { return WorkflowDraft.parse({ id: "flow", rootAgent: { id: "agent", name: "助手", role: "处理" }, memoryPolicy: { taskContext: true, longTerm: false }, nodes: {
  work: { id: "work", title: "生成业务结果", type: "ai" }, "source-private-id": { id: "source-private-id", title: "客户资料", type: "tool" },
} }); }
function props(node?: WorkflowNode, workflow = flow()) { return { node: node ?? workflow.nodes.work, workflow, onNodeChange }; }
function start() { fireEvent.click(screen.getByRole("button", { name: "开始配置输入映射" })); fireEvent.click(screen.getByRole("button", { name: "添加字段映射" })); }
function row() { return within(screen.getByRole("group", { name: "字段映射 1" })); }
function target(name = "customer.name") { fireEvent.change(row().getByRole("textbox", { name: "目标路径第 1 层" }), { target: { value: name } }); }
function literal(value = "0") { fireEvent.change(row().getByRole("combobox", { name: "字段来源" }), { target: { value: "literal" } }); fireEvent.change(row().getByRole("textbox", { name: "固定值（数据格式）" }), { target: { value } }); }
function confirm() { fireEvent.click(screen.getByRole("button", { name: "明确确认本次修改" })); }
function apply() { fireEvent.click(screen.getByRole("button", { name: "校验并应用到画布草稿" })); }
beforeEach(() => { onNodeChange.mockReset(); vi.stubGlobal("fetch", vi.fn()); });
describe("步骤输入映射编辑器", () => {
  it("初始未配置不新增映射，不请求网络或改草稿", () => {
    render(<NodeInputMappingEditor {...props()} />);
    expect(screen.getByText(/读取本页不会自动新增映射/)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "字段映射 1" })).not.toBeInTheDocument();
    expect(onNodeChange).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it("本地编辑不直接回写，完整校验和明确确认后才应用，保留节点字段", () => {
    const node = WorkflowNode.parse({ ...flow().nodes.work, description: "保留说明", next: "source", modelClass: "small" });
    render(<NodeInputMappingEditor {...props(node)} />); start(); target(); literal("false");
    expect(onNodeChange).not.toHaveBeenCalled(); apply();
    expect(onNodeChange).not.toHaveBeenCalled(); expect(screen.getByRole("dialog")).toHaveTextContent(/不会保存或执行/);
    confirm();
    expect(onNodeChange).toHaveBeenCalledTimes(1);
    const candidate = onNodeChange.mock.calls[0][0];
    expect(WorkflowNode.safeParse(candidate).success).toBe(true);
    expect(candidate).toMatchObject({ id: node.id, title: node.title, description: "保留说明", next: "source", modelClass: "small",
      inputMapping: { fields: [{ target: ["customer.name"], source: { kind: "literal", value: false }, required: true }], includeUpstreamOutputs: false } });
    expect(node).not.toHaveProperty("inputMapping");
    expect(screen.getByText(/尚未保存到服务端/)).toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled();
  });
  it("逐层路径独立输入，点名与空白精确保留", () => {
    render(<NodeInputMappingEditor {...props()} />); start(); target("字段.点名");
    fireEvent.click(row().getByRole("button", { name: "为目标路径添加一层" }));
    fireEvent.change(row().getByRole("textbox", { name: "目标路径第 2 层" }), { target: { value: " 空白名 " } });
    fireEvent.click(row().getByRole("button", { name: "为来源路径添加一层" }));
    fireEvent.change(row().getByRole("textbox", { name: "来源路径第 1 层" }), { target: { value: "来源.点名" } });
    apply(); confirm();
    expect(onNodeChange.mock.calls[0][0].inputMapping.fields[0]).toMatchObject({ target: ["字段.点名", " 空白名 "], source: { kind: "input", path: ["来源.点名"] } });
  });
  it("切换来源保留各自路径、成果选择与固定值，回退开关也保留编辑", () => {
    render(<NodeInputMappingEditor {...props()} />); start(); target();
    fireEvent.click(row().getByRole("button", { name: "为来源路径添加一层" }));
    fireEvent.change(row().getByRole("textbox", { name: "来源路径第 1 层" }), { target: { value: "输入字段" } });
    fireEvent.change(row().getByRole("combobox", { name: "字段来源" }), { target: { value: "output" } });
    fireEvent.change(row().getByRole("combobox", { name: "来源步骤" }), { target: { value: "source-private-id" } });
    fireEvent.click(row().getByRole("button", { name: "为来源路径添加一层" }));
    fireEvent.change(row().getByRole("textbox", { name: "来源路径第 1 层" }), { target: { value: "成果字段" } });
    literal("0");
    fireEvent.change(row().getByRole("combobox", { name: "字段来源" }), { target: { value: "input" } });
    expect(row().getByRole("textbox", { name: "来源路径第 1 层" })).toHaveValue("输入字段");
    fireEvent.change(row().getByRole("combobox", { name: "字段来源" }), { target: { value: "output" } });
    expect(row().getByRole("textbox", { name: "来源路径第 1 层" })).toHaveValue("成果字段");
    expect(row().getByRole("combobox", { name: "来源步骤" })).toHaveValue("source-private-id");
    fireEvent.change(row().getByRole("combobox", { name: "字段来源" }), { target: { value: "literal" } });
    expect(row().getByRole("textbox", { name: "固定值（数据格式）" })).toHaveValue("0");
    const fallback = row().getByRole("checkbox", { name: "明确配置来源缺失时的回退值" });
    fireEvent.click(fallback); fireEvent.change(row().getByRole("textbox", { name: "回退值（数据格式）" }), { target: { value: "false" } }); fireEvent.click(fallback); fireEvent.click(fallback);
    expect(row().getByRole("textbox", { name: "回退值（数据格式）" })).toHaveValue("false");
  });
  it("必需与回退的零否值按明确设置传递", () => {
    render(<NodeInputMappingEditor {...props()} />); start(); target("金额");
    fireEvent.click(row().getByRole("checkbox", { name: "来源缺失且没有回退值时，阻止本步骤继续" }));
    fireEvent.click(row().getByRole("checkbox", { name: "明确配置来源缺失时的回退值" }));
    fireEvent.change(row().getByRole("textbox", { name: "回退值（数据格式）" }), { target: { value: "0" } });
    apply(); confirm();
    expect(onNodeChange.mock.calls[0][0].inputMapping.fields[0]).toMatchObject({ required: false, fallback: 0 });
  });
  it.each(["__proto__", "constructor", "prototype", ""])("非法目标 %s 留在编辑器，不进入草稿", (name) => {
    render(<NodeInputMappingEditor {...props()} />); start(); target(name); literal(); apply();
    expect(onNodeChange).not.toHaveBeenCalled(); expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("目标不能为空");
  });
  it("删除与清除必须确认；取消保留，清除再应用不悄悄添加空映射", () => {
    const node = WorkflowNode.parse({ ...flow().nodes.work, inputMapping: { fields: [{ target: ["金额"], source: { kind: "literal", value: 0 } }] } });
    render(<NodeInputMappingEditor {...props(node)} />);
    fireEvent.click(row().getByRole("button", { name: "删除这条映射" })); fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(row().getByRole("textbox", { name: "固定值（数据格式）" })).toHaveValue("0");
    fireEvent.click(screen.getByRole("button", { name: "清除输入映射" })); expect(onNodeChange).not.toHaveBeenCalled(); confirm();
    expect(screen.getByText(/读取本页不会自动新增映射/)).toBeInTheDocument();
    expect(onNodeChange).not.toHaveBeenCalled(); apply(); confirm();
    expect(onNodeChange.mock.calls[0][0]).not.toHaveProperty("inputMapping");
  });
  it("额外成果扩大范围需确认，知识检索没有此开关", () => {
    const view = render(<NodeInputMappingEditor {...props()} />); start(); target(); literal();
    const inclusion = screen.getByRole("checkbox", { name: "除映射字段外，额外携带全部上游成果" });
    fireEvent.click(inclusion);
    expect(inclusion).not.toBeChecked(); confirm();
    expect(screen.getByRole("checkbox", { name: "除映射字段外，额外携带全部上游成果" })).toBeChecked(); expect(onNodeChange).not.toHaveBeenCalled();
    view.unmount();
    render(<NodeInputMappingEditor {...props(WorkflowNode.parse({ ...flow().nodes.work, type: "knowledge" }))} />); start();
    expect(screen.queryByRole("checkbox", { name: "除映射字段外，额外携带全部上游成果" })).not.toBeInTheDocument();
    expect(screen.getByText(/此步骤只允许逐项映射/)).toBeInTheDocument();
  });
  it("应用确认在外部草稿变化后失效，原未应用值保留", () => {
    const workflow = flow(), node = workflow.nodes.work;
    const view = render(<NodeInputMappingEditor {...props(node, workflow)} />); start(); target(); literal(); apply();
    const next = WorkflowNode.parse({ ...node, description: "他人更新" });
    view.rerender(<NodeInputMappingEditor {...props(next, { ...workflow, nodes: { ...workflow.nodes, work: next } })} />);
    confirm();
    expect(onNodeChange).not.toHaveBeenCalled(); expect(screen.getAllByRole("alert").some((item) => item.textContent?.includes("原确认失效"))).toBe(true);
    expect(row().getByRole("textbox", { name: "固定值（数据格式）" })).toHaveValue("0");
    expect(screen.getByRole("button", { name: "校验并应用到画布草稿" })).toBeDisabled();
  });
  it("删除确认在节点切换后失效，切回来未应用内容仍保留", () => {
    const workflow = flow();
    const node = WorkflowNode.parse({ ...workflow.nodes.work, inputMapping: { fields: [{ target: ["原字段"], source: { kind: "literal", value: false } }] } });
    const view = render(<NodeInputMappingEditor {...props(node, workflow)} />);
    fireEvent.click(row().getByRole("button", { name: "删除这条映射" }));
    view.rerender(<NodeInputMappingEditor {...props(workflow.nodes["source-private-id"], workflow)} />); confirm();
    expect(onNodeChange).not.toHaveBeenCalled();
    view.rerender(<NodeInputMappingEditor {...props(node, workflow)} />);
    expect(row().getByRole("textbox", { name: "固定值（数据格式）" })).toHaveValue("false");
  });
  it("当前定义不支持原映射时只读保留，不提供删除或应用", () => {
    const original = { ...flow().nodes.work, type: "human", inputMapping: { fields: [{ target: ["金额"], source: { kind: "literal", value: 0 }, required: true }], includeUpstreamOutputs: false } } as WorkflowNode;
    render(<NodeInputMappingEditor {...props(original)} />);
    expect(screen.getByText(/原映射保留 1 条/)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "原输入映射只读内容" })).toHaveTextContent("目标逐层名称：「金额」");
    expect(screen.getByRole("list", { name: "原输入映射只读内容" })).toHaveTextContent("固定值：0");
    expect(screen.queryByRole("button", { name: "清除输入映射" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "校验并应用到画布草稿" })).not.toBeInTheDocument();
    expect(onNodeChange).not.toHaveBeenCalled();
  });
  it("未知原来源显示保留提示，不暴露编号也不自动改选", () => {
    const node = WorkflowNode.parse({ ...flow().nodes.work, inputMapping: { fields: [{ target: ["字段"], source: { kind: "output", nodeId: "private-missing-id", path: [] } }] } });
    render(<NodeInputMappingEditor {...props(node)} />);
    expect(row().getByRole("combobox", { name: "来源步骤" })).toHaveValue("private-missing-id");
    expect(screen.getByText("原来源目前无法核对（配置已保留）")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("private-missing-id"); expect(document.body.textContent).not.toContain("source-private-id");
    apply(); expect(onNodeChange).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toHaveTextContent("有原来源目前无法核对");
  });
  it("回到父画布已接受的候选后能继续编辑，重读需确认舍弃本页内容", () => {
    const workflow = flow(), view = render(<NodeInputMappingEditor {...props(workflow.nodes.work, workflow)} />);
    start(); target(); literal(); apply(); confirm();
    const candidate = onNodeChange.mock.calls[0][0] as WorkflowNode;
    view.rerender(<NodeInputMappingEditor {...props(candidate, { ...workflow, nodes: { ...workflow.nodes, work: candidate } })} />);
    expect(screen.getByRole("button", { name: "校验并应用到画布草稿" })).not.toBeDisabled();
    fireEvent.change(row().getByRole("textbox", { name: "固定值（数据格式）" }), { target: { value: "123" } });
    const editedValue = row().getByRole("textbox", { name: "固定值（数据格式）" });
    fireEvent.click(screen.getByRole("button", { name: "重新读取当前草稿" })); expect(editedValue).toHaveValue("123"); confirm();
    expect(row().getByRole("textbox", { name: "固定值（数据格式）" })).toHaveValue("0"); expect(onNodeChange).toHaveBeenCalledTimes(1);
  });
});
