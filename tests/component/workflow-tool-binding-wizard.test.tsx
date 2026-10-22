import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCallback, useState, type ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import { ToolRegistryOption } from "@/contracts/tool-registry";
import { WorkflowDraft } from "@/contracts/workflow";
import { WorkflowToolBindingWizard } from "@/features/workflow-canvas/WorkflowToolBindingWizard";
import { prepareWorkflowToolBindings } from "@/features/workflow-canvas/workflow-tool-binding-planning";

const read = ToolRegistryOption.parse({ id: "customers.read", name: "客户查询", description: "查找真实客户登记", action: "lookup", scope: "customer.read", risk: "low", operationKind: "read", inputSchema: { type: "object", properties: { customer: { type: "string", title: "客户名称" } } }, outputSchema: { type: "object", properties: { result: { type: "object", title: "查询结果" } } } });
const write = ToolRegistryOption.parse({ ...read, id: "customers.write", name: "客户更新", description: "更新业务资料", risk: "high", operationKind: "action", action: "update", scope: "customer.write" });
const tools = [read, write];
const draft = WorkflowDraft.parse({ id: "binding-ui", rootAgent: { id: "assistant", name: "业务助手", role: "核对业务" }, nodes: {
  start: { id: "start", title: "开始", type: "trigger", next: "business" },
  business: { id: "business", title: "核对客户", type: "tool", next: "end", tool: { connector: "unbound", protocol: "unbound", unresolved: true, action: "", scope: "" } },
  end: { id: "end", title: "交付", type: "end" },
}, memoryPolicy: { taskContext: true, longTerm: false } });
type Props = ComponentProps<typeof WorkflowToolBindingWizard>;

function mount(overrides: Partial<Props> = {}) {
  const apply = vi.fn<Props["onApply"]>((rows) => prepareWorkflowToolBindings(draft, tools, rows));
  const save = vi.fn();
  const close = vi.fn(() => true);
  const unapplied = vi.fn();
  const props: Props = { workflow: draft, savedDraft: draft, toolOptions: tools, hasOtherChanges: false, pending: false, uncertainSave: false,
    feedback: null, onApply: apply, onSave: save, onClose: close, onUnappliedChange: unapplied, ...overrides };
  const view = render(<WorkflowToolBindingWizard {...props} />);
  return { ...view, props, apply, save, close, unapplied };
}
async function chooseExisting(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("checkbox", { name: "选择工具 客户查询" }));
  await user.click(screen.getByRole("button", { name: "安排使用位置" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "工具 1 使用位置" }), "business");
  await user.click(screen.getByRole("button", { name: "核对变更方案" }));
}

describe("实际工具绑定向导", () => {
  it("只选真实登记，不自动安排位置；核对实际字段并确认后才应用，不自动保存", async () => {
    const view = mount(); const { apply, save, unapplied } = view;
    const user = userEvent.setup();
    expect(screen.getByRole("button", { name: "安排使用位置" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "选择工具 客户查询" }));
    expect(unapplied).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole("button", { name: "安排使用位置" }));
    const target = screen.getByRole("combobox", { name: "工具 1 使用位置" });
    expect(target).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "核对变更方案" }));
    expect(screen.getByRole("alert")).toHaveTextContent("明确选择使用位置");
    expect(target).toHaveFocus();
    expect(apply).not.toHaveBeenCalled();
    await user.selectOptions(target, "business");
    await user.click(screen.getByRole("button", { name: "核对变更方案" }));
    expect(screen.getByRole("button", { name: "应用到本页草稿" })).toBeDisabled();
    await user.click(screen.getByText("核对输入、结果字段与执行边界"));
    expect(screen.getByText("客户名称")).toBeVisible();
    expect(screen.getByText("查询结果")).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: "确认已核对工具使用方案" }));
    await user.click(screen.getByRole("button", { name: "应用到本页草稿" }));
    expect(apply).toHaveBeenCalledOnce();
    expect(apply.mock.calls[0][0]).toEqual([{ toolId: read.id, mode: "existing", targetNodeId: "business" }]);
    expect(unapplied).toHaveBeenLastCalledWith(false);
    expect(save).not.toHaveBeenCalled();
    const result = apply.mock.results[0].value;
    if (!result.ok) throw new Error("expected binding plan");
    view.rerender(<WorkflowToolBindingWizard {...view.props} workflow={result.draft} />);
    expect(screen.getByText("工具方案已应用到本页草稿")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "保存当前草稿" }));
    expect(save).toHaveBeenCalledOnce();
  });

  it("查找不丢失选择，多项按所选顺序保留且不猜测位置", async () => {
    mount(); const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "选择工具 客户更新" }));
    await user.type(screen.getByRole("textbox", { name: "查找已登记工具" }), "查询");
    expect(screen.queryByRole("checkbox", { name: "选择工具 客户更新" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "选择工具 客户查询" }));
    expect(screen.getByText(/已选择 2 个工具/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "安排使用位置" }));
    expect(screen.getByRole("combobox", { name: "工具 1 使用位置" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "工具 2 使用位置" })).toHaveValue("");
    expect(screen.getByText("客户更新").closest("div")).toContainElement(screen.getByRole("combobox", { name: "工具 1 使用位置" }));
  });

  it("连续核对相同缺项时，每次都把焦点带回本工具的使用位置，不调用应用或保存", async () => {
    const { apply, save } = mount(); const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "选择工具 客户查询" }));
    await user.click(screen.getByRole("button", { name: "安排使用位置" }));
    const target = screen.getByRole("combobox", { name: "工具 1 使用位置" });
    const review = screen.getByRole("button", { name: "核对变更方案" });
    await user.click(review);
    expect(target).toHaveFocus();
    await user.click(review);
    expect(target).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent("明确选择使用位置");
    expect(apply).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  });

  it("两工具不能占同一已有步骤，错误定位本向导内对应选择器", async () => {
    const { apply } = mount(); const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "选择工具 客户查询" }));
    await user.click(screen.getByRole("checkbox", { name: "选择工具 客户更新" }));
    await user.click(screen.getByRole("button", { name: "安排使用位置" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "工具 1 使用位置" }), "business");
    await user.selectOptions(screen.getByRole("combobox", { name: "工具 2 使用位置" }), "business");
    await user.click(screen.getByRole("button", { name: "核对变更方案" }));
    expect(screen.getByRole("alert")).toHaveTextContent("同一个已有工具步骤不能重复安排");
    expect(screen.getByRole("combobox", { name: "工具 2 使用位置" })).toHaveFocus();
    expect(apply).not.toHaveBeenCalled();
  });

  it("插入位置不提供结束步骤，条件和循环明确标出默认及完成路径", async () => {
    const branched = WorkflowDraft.parse({ ...draft, nodes: { ...draft.nodes,
      decision: { id: "decision", title: "核对条件", type: "condition", condition: { source: "input.flag", operator: "eq", branches: [{ label: "满足", value: true, next: "end" }], defaultNext: "business" } },
      loop: { id: "loop", title: "逐项处理", type: "loop", loop: { collectionPath: "input.items", itemKey: "item", maxIterations: 5, bodyNext: "business", exitNext: "end" } },
    } });
    mount({ workflow: branched, savedDraft: branched }); const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "选择工具 客户查询" }));
    await user.click(screen.getByRole("button", { name: "安排使用位置" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "工具 1 使用方式" }), "after");
    const choices = within(screen.getByRole("combobox", { name: "工具 1 使用位置" }));
    expect(choices.queryByRole("option", { name: /交付/ })).not.toBeInTheDocument();
    expect(choices.getByRole("option", { name: /核对条件 · 默认路径之后/ })).toBeInTheDocument();
    expect(choices.getByRole("option", { name: /逐项处理 · 循环完成之后/ })).toBeInTheDocument();
  });

  it("无登记与读取失败分开，均不展示演示工具或假的授权成功", () => {
    const view = mount({ toolOptions: [] });
    expect(screen.getByText(/目前没有登记的业务工具/)).toBeVisible();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    view.rerender(<WorkflowToolBindingWizard {...view.props} toolOptions={[{ ...read, scope: "" }]} />);
    expect(screen.getAllByRole("alert").some((item) => item.textContent?.includes("工具登记暂时无法读取"))).toBe(true);
    expect(screen.queryByText("已授权")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "安排使用位置" })).toBeDisabled();
  });

  it.each(["workflow", "tools"] as const)("打开后 %s 变化时保留选择并禁止应用旧方案", async (kind) => {
    const view = mount(); const user = userEvent.setup(); await chooseExisting(user);
    view.rerender(<WorkflowToolBindingWizard {...view.props} workflow={kind === "workflow" ? { ...draft, nodes: { ...draft.nodes, business: { ...draft.nodes.business, title: "新步骤" } } } : draft} toolOptions={kind === "tools" ? [{ ...read, risk: "high" }, write] : tools} />);
    expect(screen.getByRole("alert")).toHaveTextContent("流程或工具登记已变化");
    expect(screen.getByRole("button", { name: "应用到本页草稿" })).toBeDisabled();
    expect(view.apply).not.toHaveBeenCalled();
  });

  it("关闭先确认，返回保留选择；仅确认放弃后关闭并清除未应用保护", async () => {
    const { close, unapplied } = mount(); const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "选择工具 客户查询" }));
    await user.click(screen.getByRole("button", { name: "关闭工具绑定向导" }));
    const confirm = screen.getByRole("dialog", { name: "放弃本次绑定方案？" });
    expect(close).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole("button", { name: "返回" }));
    expect(screen.getByRole("checkbox", { name: "选择工具 客户查询" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "关闭工具绑定向导" }));
    await user.click(screen.getByRole("button", { name: "放弃本次选择" }));
    expect(close).toHaveBeenCalledOnce();
    expect(unapplied).toHaveBeenLastCalledWith(false);
  });

  it("未应用计划阻止页面退出和保存快捷键，卸载后清除自己的保护", async () => {
    const { save, unapplied, unmount } = mount(); const user = userEvent.setup();
    await user.click(screen.getByRole("checkbox", { name: "选择工具 客户查询" }));
    const leave = new Event("beforeunload", { cancelable: true });
    act(() => window.dispatchEvent(leave)); expect(leave.defaultPrevented).toBe(true);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "应用工具到流程" }), { key: "s", ctrlKey: true });
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("先核对方案并应用");
    unmount(); expect(unapplied).toHaveBeenLastCalledWith(false);
    const after = new Event("beforeunload", { cancelable: true });
    act(() => window.dispatchEvent(after)); expect(after.defaultPrevented).toBe(false);
  });

  it("实际父状态保存匹配草稿时才显示已保存，保留映射与防重风险核对", async () => {
    const mapped = WorkflowDraft.parse({ ...draft, nodes: { ...draft.nodes, business: { ...draft.nodes.business,
      inputMapping: { includeUpstreamOutputs: false, fields: [{ target: ["customer"], source: { kind: "input", path: ["customer"] }, required: true }] },
      toolOperation: { scope: "customer.operation", key: { kind: "input", path: ["request"] } },
    } } });
    const save = vi.fn();
    function Parent() {
      const [current, setCurrent] = useState(mapped); const [saved, setSaved] = useState(mapped);
      const onPending = useCallback(() => {}, []);
      return <WorkflowToolBindingWizard workflow={current} savedDraft={saved} toolOptions={tools} hasOtherChanges pending={false} uncertainSave={false} feedback={null} onUnappliedChange={onPending} onClose={() => true}
        onApply={(rows) => { const result = prepareWorkflowToolBindings(current, tools, rows); if (result.ok) setCurrent(result.draft); return result; }}
        onSave={() => { save(current); setSaved(current); }} />;
    }
    render(<Parent />); const user = userEvent.setup(); await chooseExisting(user);
    expect(screen.getByText(/原输入映射、业务防重配置会保留/)).toBeVisible();
    expect(screen.getByText(/保存时会一并提交/)).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: "确认已核对工具使用方案" }));
    await user.click(screen.getByRole("button", { name: "应用到本页草稿" }));
    expect(screen.queryByText("此方案对应的草稿已保存")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保存当前草稿" }));
    await waitFor(() => expect(screen.getByText("此方案对应的草稿已保存")).toBeVisible());
    expect(save.mock.calls[0][0].nodes.business.inputMapping).toEqual(mapped.nodes.business.inputMapping);
    expect(save.mock.calls[0][0].nodes.business.toolOperation).toEqual(mapped.nodes.business.toolOperation);
  });

  it("应用后读取到另一份已保存草稿时明确区分旧方案，不提供无动作保存按钮", async () => {
    const view = mount(); const user = userEvent.setup(); await chooseExisting(user);
    await user.click(screen.getByRole("checkbox", { name: "确认已核对工具使用方案" }));
    await user.click(screen.getByRole("button", { name: "应用到本页草稿" }));
    const result = view.apply.mock.results[0].value;
    if (!result.ok) throw new Error("expected binding plan");
    const newer = { ...result.draft, nodes: { ...result.draft.nodes, business: { ...result.draft.nodes.business, title: "服务端的新步骤名称" } } };
    view.rerender(<WorkflowToolBindingWizard {...view.props} workflow={newer} savedDraft={newer} />);
    expect(screen.getByText("当前草稿已保存，并在应用后更新")).toBeVisible();
    expect(screen.queryByText("此方案对应的草稿已保存")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存当前草稿" })).toBeDisabled();
    expect(view.save).not.toHaveBeenCalled();
  });
});
