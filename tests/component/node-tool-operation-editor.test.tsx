import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToolRegistryOption } from "@/contracts/tool-registry";
import { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { NodeToolOperationEditor } from "@/features/workflow-canvas/NodeToolOperationEditor";

function fixture(configured = false) {
  const tool = ToolRegistryOption.parse({ id: "private-registry-id", name: "提交订单", action: "submit", scope: "private-order-scope", risk: "high", protocol: "http-json", businessIdempotency: true, businessIdempotencyRetentionMs: 300000 });
  const node = WorkflowNode.parse({ id: "private-node-id", title: "提交订单", type: "tool", next: "end", tool: { connector: tool.name, action: tool.action, scope: tool.scope, risk: tool.risk, registryToolId: tool.id, protocol: tool.protocol, inputSchema: tool.inputSchema, outputSchema: tool.outputSchema }, ...(configured ? { toolOperation: { scope: "private-original-scope", key: { kind: "input", path: ["order", "number"] } } } : {}) });
  const workflow = WorkflowDraft.parse({ id: "private-workflow-id", versionId: "original-version", rootAgent: { id: "agent", name: "订单助手", role: "订单处理" }, nodes: { start: { id: "start", title: "开始", type: "trigger", next: node.id }, [node.id]: node, end: { id: "end", title: "结束", type: "end" } }, variables: [{ name: "order", label: "订单资料", type: "object", scope: "run" }], memoryPolicy: { taskContext: true, longTerm: false } });
  return { node, workflow, tools: [tool] };
}

function editFixed(value = "0") {
  fireEvent.change(screen.getByLabelText("业务标识来源"), { target: { value: "literal" } });
  fireEvent.change(screen.getByLabelText("固定值类型"), { target: { value: "number" } });
  fireEvent.change(screen.getByLabelText("固定业务标识"), { target: { value } });
}

describe("防重配置叶组件", () => {
  it("首次打开无默认写入，显式选择范围和零后才交父接收", () => {
    const props = fixture(); const onNodeChange = vi.fn<(node: WorkflowNode) => boolean>(() => true);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<NodeToolOperationEditor {...props} onNodeChange={onNodeChange} />);
    fireEvent.click(screen.getByLabelText("设置业务操作防重"));
    expect(onNodeChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("防重范围")).toHaveValue("");
    expect(screen.getByLabelText("业务标识来源")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("防重范围"), { target: { value: "registered" } }); editFixed();
    fireEvent.click(screen.getByRole("button", { name: "应用到当前草稿" }));
    expect(onNodeChange).toHaveBeenCalledTimes(1);
    expect(onNodeChange.mock.calls[0][0]).toMatchObject({ toolOperation: { scope: props.tools[0].scope, key: { kind: "literal", value: 0 } } });
    expect(screen.getByRole("status")).toHaveTextContent("尚未保存或发布");
    expect(fetchSpy).not.toHaveBeenCalled(); fetchSpy.mockRestore();
  });
  it.each([false, null, undefined, "true", Promise.resolve(true)])("父组件未明确确认时保留输入且不显示成功：%s", (answer) => {
    const props = fixture(); const onNodeChange = vi.fn(() => answer) as unknown as (node: WorkflowNode) => boolean;
    render(<NodeToolOperationEditor {...props} onNodeChange={onNodeChange} />);
    fireEvent.click(screen.getByLabelText("设置业务操作防重"));
    fireEvent.change(screen.getByLabelText("防重范围"), { target: { value: "registered" } }); editFixed("12");
    fireEvent.click(screen.getByRole("button", { name: "应用到当前草稿" }));
    expect(screen.getByLabelText("固定业务标识")).toHaveValue("12");
    expect(screen.queryByRole("status")).toBeNull(); expect(screen.getByRole("alert")).toHaveTextContent("没有确认接收");
    expect(props.node).not.toHaveProperty("toolOperation");
  });
  it("父组件抛错时不泄露错误、不丢输入", () => {
    render(<NodeToolOperationEditor {...fixture()} onNodeChange={() => { throw new Error("secret-backend-id"); }} />);
    fireEvent.click(screen.getByLabelText("设置业务操作防重"));
    fireEvent.change(screen.getByLabelText("防重范围"), { target: { value: "registered" } }); editFixed("12");
    fireEvent.click(screen.getByRole("button", { name: "应用到当前草稿" }));
    expect(screen.getByRole("alert")).toHaveTextContent("未接收修改");
    expect(screen.getByLabelText("固定业务标识")).toHaveValue("12");
    expect(screen.queryByText(/secret-backend-id/)).toBeNull();
  });
  it("原规则清除被父拒收时不显示成功，仍保留原始只读内容", () => {
    const props = fixture(true); const onNodeChange = vi.fn<(node: WorkflowNode) => boolean>(() => false);
    render(<NodeToolOperationEditor {...props} onNodeChange={onNodeChange} />);
    fireEvent.click(screen.getByLabelText("设置业务操作防重"));
    fireEvent.click(screen.getByRole("button", { name: "确认清除防重规则" }));
    expect(onNodeChange).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByLabelText("原始防重规则只读")).toHaveValue(JSON.stringify(props.node.toolOperation));
  });
  it("替换原规则和清除均需最终确认，取消不改原稿", () => {
    const props = fixture(true); const onNodeChange = vi.fn<(node: WorkflowNode) => boolean>(() => true);
    render(<NodeToolOperationEditor {...props} onNodeChange={onNodeChange} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑防重规则" })); editFixed();
    fireEvent.click(screen.getByRole("button", { name: "应用到当前草稿" }));
    expect(onNodeChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    expect(screen.getByLabelText("固定业务标识")).toHaveValue("0");
    fireEvent.click(screen.getByRole("button", { name: "应用到当前草稿" }));
    fireEvent.click(screen.getByRole("button", { name: "确认替换防重规则" }));
    expect(onNodeChange).toHaveBeenCalledTimes(1);
    expect(onNodeChange.mock.calls[0][0].toolOperation?.scope).toBe("private-original-scope");
  });
  it("清除确认后只移除防重配置", () => {
    const props = fixture(true); const onNodeChange = vi.fn<(node: WorkflowNode) => boolean>(() => true);
    render(<NodeToolOperationEditor {...props} onNodeChange={onNodeChange} />);
    fireEvent.click(screen.getByLabelText("设置业务操作防重")); expect(onNodeChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认清除防重规则" }));
    expect(onNodeChange).toHaveBeenCalledTimes(1);
    expect(onNodeChange.mock.calls[0][0]).not.toHaveProperty("toolOperation");
    expect(onNodeChange.mock.calls[0][0].tool).toEqual(props.node.tool);
  });
  it.each(["node", "workflow", "tools"])("上下文A→B→A使旧替换确认永久失效：%s", (target) => {
    const props = fixture(true); const onNodeChange = vi.fn<(node: WorkflowNode) => boolean>(() => true);
    const { rerender } = render(<NodeToolOperationEditor {...props} onNodeChange={onNodeChange} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑防重规则" })); editFixed("12");
    fireEvent.click(screen.getByRole("button", { name: "应用到当前草稿" }));
    const changed = target === "node" ? { ...props, node: { ...props.node, description: "另一个说明" } } : target === "workflow" ? { ...props, workflow: { ...props.workflow, versionId: "changed-version" } } : { ...props, tools: [{ ...props.tools[0], businessIdempotencyRetentionMs: 600000 }] };
    rerender(<NodeToolOperationEditor {...changed} onNodeChange={onNodeChange} />);
    rerender(<NodeToolOperationEditor {...props} onNodeChange={onNodeChange} />);
    fireEvent.click(screen.getByRole("button", { name: "确认替换防重规则" }));
    expect(onNodeChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("固定业务标识")).toHaveValue("12");
    expect(screen.getByRole("button", { name: "应用到当前草稿" })).toBeDisabled();
  });
  it("清除确认也在完整流程往返变化后失效", () => {
    const props = fixture(true); const onNodeChange = vi.fn<(node: WorkflowNode) => boolean>(() => true);
    const { rerender } = render(<NodeToolOperationEditor {...props} onNodeChange={onNodeChange} />);
    fireEvent.click(screen.getByLabelText("设置业务操作防重"));
    rerender(<NodeToolOperationEditor {...props} workflow={{ ...props.workflow, versionId: "another-version" }} onNodeChange={onNodeChange} />);
    rerender(<NodeToolOperationEditor {...props} onNodeChange={onNodeChange} />);
    fireEvent.click(screen.getByRole("button", { name: "确认清除防重规则" }));
    expect(onNodeChange).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toHaveTextContent("重新确认");
  });
  it("表单A→B→A撤销旧确认，必须重新打开最终确认", () => {
    const props = fixture(true); const onNodeChange = vi.fn<(node: WorkflowNode) => boolean>(() => true);
    render(<NodeToolOperationEditor {...props} onNodeChange={onNodeChange} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑防重规则" })); editFixed("12");
    fireEvent.click(screen.getByRole("button", { name: "应用到当前草稿" }));
    fireEvent.change(screen.getByLabelText("固定业务标识"), { target: { value: "13" } });
    fireEvent.change(screen.getByLabelText("固定业务标识"), { target: { value: "12" } });
    expect(screen.queryByRole("button", { name: "确认替换防重规则" })).toBeNull();
    expect(onNodeChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "应用到当前草稿" }));
    fireEvent.click(screen.getByRole("button", { name: "确认替换防重规则" })); expect(onNodeChange).toHaveBeenCalledTimes(1);
  });
  it("业务输入字段通过中文选择、分段路径传入，动态值不冒充已验证", () => {
    const props = fixture(); const onNodeChange = vi.fn<(node: WorkflowNode) => boolean>(() => true);
    render(<NodeToolOperationEditor {...props} onNodeChange={onNodeChange} />);
    fireEvent.click(screen.getByLabelText("设置业务操作防重"));
    fireEvent.change(screen.getByLabelText("防重范围"), { target: { value: "registered" } });
    fireEvent.change(screen.getByLabelText("业务标识来源"), { target: { value: "input" } });
    expect(screen.getByRole("option", { name: "订单资料" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("业务输入字段"), { target: { value: "order" } });
    fireEvent.click(screen.getByRole("button", { name: "添加下一级字段" }));
    fireEvent.change(screen.getByLabelText("第2级字段"), { target: { value: "order.number" } });
    expect(screen.getByText(/当前不能证明它有效/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "应用到当前草稿" }));
    expect(onNodeChange.mock.calls[0][0].toolOperation?.key).toEqual({ kind: "input", path: ["order", "order.number"] });
  });
  it("内部范围和标识只在维护人员原始只读区展示", () => {
    const props = fixture(true);
    render(<NodeToolOperationEditor {...props} onNodeChange={() => true} />);
    const raw = screen.getByLabelText("原始防重规则只读");
    expect(raw).toHaveAttribute("readonly"); expect(raw).toHaveValue(JSON.stringify(props.node.toolOperation));
    expect(screen.queryAllByText(/private-original-scope|private-registry-id|private-node-id|private-workflow-id/)).toEqual([raw]);
  });
  it("登记未知不自动启用、不清除已有规则", () => {
    const props = fixture(true); const { businessIdempotency: omitted, ...tool } = props.tools[0]; void omitted;
    const onNodeChange = vi.fn<(node: WorkflowNode) => boolean>(() => true);
    render(<NodeToolOperationEditor {...props} tools={[tool]} onNodeChange={onNodeChange} />);
    expect(screen.getByLabelText("设置业务操作防重")).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("尚未明确登记");
    expect(screen.getByLabelText("原始防重规则只读")).toHaveValue(JSON.stringify(props.node.toolOperation));
    expect(onNodeChange).not.toHaveBeenCalled();
  });
});
