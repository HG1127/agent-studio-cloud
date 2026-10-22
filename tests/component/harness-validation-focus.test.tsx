import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeDefaultsDraft, RuleConditionsDraft } from "@/features/harness/RuntimeDefaultsDraft";

const network = vi.fn();

function observeFocus(field: HTMLElement) {
  const observations: { invalid: string | null; descriptions: string[]; connected: boolean[]; error: string | null; expanded: boolean | undefined }[] = [];
  field.addEventListener("focus", () => {
    const descriptions = (field.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    observations.push({
      invalid: field.getAttribute("aria-invalid"), descriptions,
      connected: descriptions.map((id) => document.getElementById(id)?.isConnected === true),
      error: document.getElementById(`${field.id}-error`)?.textContent ?? null,
      expanded: field.closest("details")?.open,
    });
  });
  return observations;
}

function expectCommittedError(observations: ReturnType<typeof observeFocus>, field: HTMLElement, error: string, expanded?: boolean) {
  expect(observations).toEqual([{
    invalid: "true", descriptions: [`${field.id}-hint`, `${field.id}-error`],
    connected: [true, true], error, expanded,
  }]);
  expect(field).toHaveFocus();
  expect(field).toHaveAccessibleDescription(expect.stringContaining(error));
}

function fillRuntime(form: HTMLElement) {
  const fields = within(form);
  for (const [label, value] of [
    ["步骤失败时怎么处理", "safe_default"], ["怎样检查交付结果", "contract_safety"],
    ["拦截疑似敏感内容", "yes"], ["失败任务始终评估", "yes"],
    ["涉及人工确认的任务始终评估", "no"], ["未通过评估的任务加入回归候选", "no"],
  ]) fireEvent.change(fields.getByRole("combobox", { name: label }), { target: { value } });
  for (const [label, value] of [
    ["每次最多参考多少条记忆", "5"], ["记忆内容上限（字符）", "1000"], ["常规任务抽查比例（%）", "10"],
  ]) fireEvent.change(fields.getByRole("textbox", { name: label }), { target: { value } });
  const details = fields.getByText("高级设置：计划与上下文容量").closest("details");
  if (!details) throw new Error("缺少高级容量分区");
  details.open = true;
  fireEvent.change(fields.getByRole("combobox", { name: "如何生成执行计划" }), { target: { value: "workflow_static" } });
  fireEvent.change(fields.getByRole("textbox", { name: "上下文上限（字符）" }), { target: { value: "4000" } });
  return details;
}

describe("运行规则草稿在错误提示提交后定位字段", () => {
  beforeEach(() => {
    network.mockReset(); vi.stubGlobal("fetch", network);
    vi.spyOn(Storage.prototype, "setItem");
  });
  afterEach(() => {
    cleanup();
    expect(network).not.toHaveBeenCalled();
    expect(Storage.prototype.setItem).not.toHaveBeenCalled();
    vi.unstubAllGlobals(); vi.restoreAllMocks();
  });

  it("默认规则首次聚焦时已具备错误状态和可读取的完整描述", async () => {
    render(<RuntimeDefaultsDraft />);
    const field = screen.getByRole("combobox", { name: "步骤失败时怎么处理" });
    const observations = observeFocus(field);
    await userEvent.setup().click(screen.getByRole("button", { name: "检查草稿" }));
    expectCommittedError(observations, field, "请选择失败处理方式");
    expect(screen.getByRole("alert")).toHaveTextContent("尚未保存或生效");
  });

  it("规则设计首次聚焦时已能读取规则名称错误", async () => {
    render(<RuleConditionsDraft />);
    const field = screen.getByRole("textbox", { name: "草稿规则名称" });
    const observations = observeFocus(field);
    await userEvent.setup().click(screen.getByRole("button", { name: "检查规则设计" }));
    expectCommittedError(observations, field, "请填写规则名称");
  });

  it("关闭的高级容量分区先展开，原生焦点事件即可读取容量错误", async () => {
    render(<RuntimeDefaultsDraft />);
    const details = fillRuntime(screen.getByRole("form", { name: "默认运行规则草稿" }));
    const field = screen.getByRole("textbox", { name: "上下文上限（字符）" });
    fireEvent.change(field, { target: { value: "60001" } });
    const observations = observeFocus(field); details.open = false;
    await userEvent.setup().click(screen.getByRole("button", { name: "检查草稿" }));
    expectCommittedError(observations, field, "请填写 2,000–60,000 之间的整数", true);
  });

  it("身份条件折叠时同样先提交错误再展开和聚焦", async () => {
    render(<RuleConditionsDraft />);
    fireEvent.change(screen.getByRole("textbox", { name: "草稿规则名称" }), { target: { value: "外部操作先确认" } });
    fireEvent.change(screen.getByRole("combobox", { name: "设计中的步骤范围" }), { target: { value: "tool" } });
    fireEvent.change(screen.getByRole("combobox", { name: "设计中的处理方式" }), { target: { value: "require_approval" } });
    const field = screen.getByLabelText("待模拟身份");
    const observations = observeFocus(field);
    await userEvent.setup().click(screen.getByRole("button", { name: "检查规则设计" }));
    expectCommittedError(observations, field, "请选择模拟身份", true);
    expect(screen.queryByText(/本地草稿检查通过/)).not.toBeInTheDocument();
  });

  it("同一字段改成另一无效值后再次检查，不复用上次错误提交前的状态", async () => {
    render(<RuntimeDefaultsDraft />); const user = userEvent.setup();
    fillRuntime(screen.getByRole("form", { name: "默认运行规则草稿" }));
    const field = screen.getByRole("textbox", { name: "每次最多参考多少条记忆" });
    fireEvent.change(field, { target: { value: "21" } });
    const observations = observeFocus(field);
    await user.click(screen.getByRole("button", { name: "检查草稿" }));
    expectCommittedError(observations, field, "请填写 0–20 之间的整数");
    observations.length = 0;
    fireEvent.change(field, { target: { value: "abc" } });
    expect(field).toHaveAttribute("aria-invalid", "false");
    expect(document.getElementById(`${field.id}-error`)).toBeNull();
    await user.click(screen.getByRole("button", { name: "检查草稿" }));
    expectCommittedError(observations, field, "请填写 0–20 之间的整数");
  });

  it("修正全部字段后检查通过，不再将焦点送回之前的错误字段", async () => {
    render(<RuntimeDefaultsDraft />); const user = userEvent.setup();
    const field = screen.getByRole("combobox", { name: "步骤失败时怎么处理" });
    const observations = observeFocus(field);
    const check = screen.getByRole("button", { name: "检查草稿" });
    await user.click(check);
    expectCommittedError(observations, field, "请选择失败处理方式");
    observations.length = 0;
    fillRuntime(screen.getByRole("form", { name: "默认运行规则草稿" }));
    await user.click(check);
    expect(observations).toEqual([]); expect(check).toHaveFocus();
    expect(field).toHaveAttribute("aria-invalid", "false");
    expect(screen.getByRole("status")).toHaveTextContent("未保存，也未改变任何运行");
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(false);
  });

  it("两份同名表单只定位各自错误，不共用字段描述或填写", async () => {
    render(<><RuntimeDefaultsDraft /><RuntimeDefaultsDraft /></>);
    const forms = screen.getAllByRole("form", { name: "默认运行规则草稿" });
    const first = within(forms[0]).getByRole("combobox", { name: "步骤失败时怎么处理" });
    const second = within(forms[1]).getByRole("combobox", { name: "步骤失败时怎么处理" });
    const firstObservations = observeFocus(first); const secondObservations = observeFocus(second);
    fireEvent.change(first, { target: { value: "human_first" } });
    await userEvent.setup().click(within(forms[1]).getByRole("button", { name: "检查草稿" }));
    expectCommittedError(secondObservations, second, "请选择失败处理方式");
    expect(firstObservations).toEqual([]); expect(first.id).not.toBe(second.id);
    expect(first).toHaveAttribute("aria-invalid", "false"); expect(first).toHaveValue("human_first");
    expect(within(forms[0]).queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each(["hidden", "inert", "aria-hidden"])("表单位于 %s 分区内时不抢走其他分区的焦点", (attribute) => {
    render(<><button>当前分区操作</button><section data-testid="inactive"><RuntimeDefaultsDraft /></section></>);
    const form = screen.getByRole("form", { name: "默认运行规则草稿" });
    const field = screen.getByRole("combobox", { name: "步骤失败时怎么处理" });
    const observations = observeFocus(field);
    const outside = screen.getByRole("button", { name: "当前分区操作" });
    screen.getByTestId("inactive").setAttribute(attribute, attribute === "aria-hidden" ? "true" : "");
    outside.focus(); fireEvent.submit(form);
    expect(outside).toHaveFocus(); expect(observations).toEqual([]);
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(/请选择失败处理方式/);
  });

  it("检查事件后立即卸载，不向已移除或新表单交付旧焦点", () => {
    const view = render(<RuntimeDefaultsDraft />);
    const form = screen.getByRole("form", { name: "默认运行规则草稿" });
    const field = screen.getByRole("combobox", { name: "步骤失败时怎么处理" });
    const observations = observeFocus(field);
    act(() => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      view.unmount();
    });
    expect(field.isConnected).toBe(false); expect(observations).toEqual([]);
    render(<RuntimeDefaultsDraft />);
    expect(screen.getByRole("combobox", { name: "步骤失败时怎么处理" })).not.toHaveFocus();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(true);
  });

  it("严格模式下每次检查只定位一次，卸载释放自己的离页保护", async () => {
    const view = render(<StrictMode><RuntimeDefaultsDraft /></StrictMode>);
    const field = screen.getByRole("combobox", { name: "步骤失败时怎么处理" });
    const observations = observeFocus(field);
    await userEvent.setup().click(screen.getByRole("button", { name: "检查草稿" }));
    expectCommittedError(observations, field, "请选择失败处理方式");
    fireEvent.change(field, { target: { value: "safe_default" } });
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(false);
    view.unmount();
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(true);
  });

  it("错误后撤销及清空只回到草稿按钮，不恢复过期的错误焦点", async () => {
    render(<RuntimeDefaultsDraft />); const user = userEvent.setup();
    const form = screen.getByRole("form", { name: "默认运行规则草稿" });
    fillRuntime(form); const check = screen.getByRole("button", { name: "检查草稿" });
    await user.click(check);
    const field = screen.getByRole("textbox", { name: "每次最多参考多少条记忆" });
    fireEvent.change(field, { target: { value: "21" } });
    const observations = observeFocus(field);
    await user.click(check); expectCommittedError(observations, field, "请填写 0–20 之间的整数");
    observations.length = 0;
    await user.click(screen.getByRole("button", { name: "撤销修改" }));
    await user.click(screen.getByRole("button", { name: "确认撤销" }));
    expect(field).toHaveValue("5"); expect(field).toHaveAttribute("aria-invalid", "false");
    expect(check).toHaveFocus(); expect(observations).toEqual([]);
    await user.click(screen.getByRole("button", { name: "清空草稿" }));
    await user.click(screen.getByRole("button", { name: "确认清空草稿" }));
    expect(field).toHaveValue(""); expect(check).toHaveFocus(); expect(observations).toEqual([]);
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(true);
  });
});
