import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentInputContract } from "@/contracts/manifest";
import { WebToolInputPreview } from "@/features/web-tools/WebToolInputPreview";
import { WebToolOutputPreview } from "@/features/web-tools/WebToolOutputPreview";
import { inspectPreviewInput, checkPreviewInput } from "@/features/web-tools/preview-input";

vi.mock("@/server/actions/start-run-task", () => ({ startRunTaskAction: vi.fn() }));

const fields = AgentInputContract.parse({ fields: [
  { name: "customer", label: "客户需求", required: true, type: "string" },
  { name: "amount", label: "预算", required: true, type: "number" },
  { name: "approved", label: "负责人已核对", required: false, type: "boolean" },
  { name: "details", label: "补充信息", required: false, type: "object" },
  { name: "items", label: "资料清单", required: false, type: "array" },
] }).fields;
afterEach(() => vi.unstubAllGlobals());

describe("网页工具本地预览交互", () => {
  it("集中列出实际字段问题并可定位，修改后重核对，不显示试填内容", async () => {
    const user = userEvent.setup();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<WebToolInputPreview fields={fields} />);
    await user.type(screen.getByRole("textbox", { name: /预算/ }), "不能读取的数字");
    await user.type(screen.getByRole("textbox", { name: /补充信息/ }), "非对象试填内容");
    await user.click(screen.getByRole("button", { name: "检查填写格式" }));
    const summary = screen.getByRole("status");
    expect(summary).toHaveTextContent("有 3 处填写需要修改");
    expect(summary).not.toHaveTextContent("非对象试填内容");
    expect(screen.getByRole("textbox", { name: /客户需求/ })).toHaveFocus();
    const amount = screen.getByRole("textbox", { name: /预算/ });
    expect(amount).toHaveAttribute("aria-invalid", "true");
    expect(amount).toHaveAccessibleDescription(/预算需要填写数字/);
    await user.click(within(summary).getByRole("button", { name: "预算需要填写数字" }));
    expect(amount).toHaveFocus();
    await user.clear(amount);
    await user.type(amount, "0");
    expect(amount).toHaveAttribute("aria-invalid", "false");
    expect(screen.getByRole("status")).toHaveTextContent("有 2 处填写需要修改");
    await user.type(screen.getByRole("textbox", { name: /客户需求/ }), "核对资料\n保留原始说明");
    const detail = screen.getByRole("textbox", { name: /补充信息/ });
    await user.clear(detail);
    await user.type(detail, "{{}", { skipClick: true });
    expect(screen.getByRole("status")).toHaveTextContent("已核对 3 项填写格式");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("切换单列双列只改变当前布局，保留输入和检查，不发请求", async () => {
    const user = userEvent.setup();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<WebToolInputPreview fields={fields.slice(0, 1)} />);
    const control = screen.getByRole("textbox", { name: /客户需求/ });
    await user.type(control, "未保存的多行需求\n第二行");
    await user.click(screen.getByRole("button", { name: "检查填写格式" }));
    await user.click(screen.getByRole("button", { name: "单列填写" }));
    expect(screen.getByRole("button", { name: "单列填写" })).toHaveAttribute("aria-pressed", "true");
    expect(control).toHaveValue("未保存的多行需求\n第二行");
    expect(screen.getByRole("status")).toHaveTextContent("已核对 1 项填写格式");
    await user.click(screen.getByRole("button", { name: "双列填写" }));
    expect(screen.getByRole("button", { name: "双列填写" })).toHaveAttribute("aria-pressed", "true");
    expect(control).toHaveValue("未保存的多行需求\n第二行");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("清空有内容时先确认，取消和 Escape 保留全部值，确认才清空", async () => {
    const user = userEvent.setup();
    render(<WebToolInputPreview fields={fields.slice(0, 2)} />);
    await user.type(screen.getByRole("textbox", { name: /客户需求/ }), "未保存需求");
    await user.type(screen.getByRole("textbox", { name: /预算/ }), "50");
    await user.click(screen.getByRole("button", { name: "清空试填" }));
    const dialog = screen.getByRole("dialog", { name: "清空当前试填内容？" });
    expect(dialog).toHaveTextContent("没有保存");
    await user.click(within(dialog).getByRole("button", { name: "返回" }));
    expect(screen.getByRole("textbox", { name: /客户需求/ })).toHaveValue("未保存需求");
    await user.click(screen.getByRole("button", { name: "清空试填" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("textbox", { name: /预算/ })).toHaveValue("50");
    await user.click(screen.getByRole("button", { name: "清空试填" }));
    await user.click(screen.getByRole("button", { name: "确认清空试填" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /客户需求/ })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: /预算/ })).toHaveValue("");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("没有试填内容时可直接清除检查状态，不弹无意义确认", async () => {
    const user = userEvent.setup();
    render(<WebToolInputPreview fields={fields.slice(0, 1)} />);
    await user.click(screen.getByRole("button", { name: "检查填写格式" }));
    await user.click(screen.getByRole("button", { name: "清空试填" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("切换版本不沿用另一版本试填或布局", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<WebToolInputPreview key="version-one" fields={fields} />);
    await user.type(screen.getByRole("textbox", { name: /客户需求/ }), "第一个版本的意见");
    await user.click(screen.getByRole("button", { name: "单列填写" }));
    rerender(<WebToolInputPreview key="version-two" fields={fields} />);
    expect(screen.getByRole("textbox", { name: /客户需求/ })).toHaveValue("");
    expect(screen.getByRole("button", { name: "双列填写" })).toHaveAttribute("aria-pressed", "true");
  });

  it("交付按已保存顺序展示卡片或清单，仅有字段占位，没有假评分或结果", async () => {
    const user = userEvent.setup();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(<WebToolOutputPreview fields={[
      { path: "privateStep.response", label: "回复依据", required: true },
      { path: "privateStep.sources", label: "  ", required: false },
    ]} />);
    const list = screen.getByRole("list", { name: "本版本交付布局" });
    expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent("回复依据");
    expect(within(list).getAllByRole("listitem")[1]).toHaveTextContent("交付内容 2");
    expect(list).not.toHaveTextContent("privateStep");
    expect(within(list).getAllByText("仅占位，尚无网页调用结果")).toHaveLength(2);
    expect(screen.queryByText(/综合评分|运行成功|已发布/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "交付清单" }));
    expect(screen.getByRole("button", { name: "交付清单" })).toHaveAttribute("aria-pressed", "true");
    expect(within(list).getAllByRole("listitem")[0]).toHaveTextContent("回复依据");
    await user.click(screen.getByRole("button", { name: "字段卡片" }));
    expect(screen.getByRole("button", { name: "字段卡片" })).toHaveAttribute("aria-pressed", "true");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("交付契约无字段时不猜测报告或补出占位字段", () => {
    render(<WebToolOutputPreview fields={[]} />);
    expect(screen.getByText(/没有定义结构化交付字段/)).toBeVisible();
    expect(screen.queryByRole("list", { name: "本版本交付布局" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "字段卡片" })).not.toBeInTheDocument();
  });
});

describe("试填沿用运行输入的共享边界", () => {
  it("同时返回多字段错误，选填空值不报错，零和否保留为已填写", () => {
    expect(inspectPreviewInput(fields, { amount: "Infinity", details: "[]", items: "{}" }).issues).toEqual([
      { fieldIndex: 0, error: "请填写客户需求" }, { fieldIndex: 1, error: "预算需要填写数字" },
      { fieldIndex: 3, error: "补充信息的结构格式不正确" }, { fieldIndex: 4, error: "资料清单的结构格式不正确" },
    ]);
    expect(inspectPreviewInput(fields, { customer: "甲", amount: "0", approved: "false" })).toEqual({ checkedFields: 3, issues: [] });
  });

  it.each<Record<string, string>>([
    { details: '{"constructor":"不应接受的字段"}' },
    { details: JSON.stringify({ a: { b: { c: { d: { e: { f: { g: { h: { i: { j: { k: { l: { m: "过深" } } } } } } } } } } } } }) },
    { items: JSON.stringify(Array.from({ length: 2001 }, () => 1)) },
  ])("结构内容使用共享深度、保留字段与项数校验 %j", (structured) => {
    const result = inspectPreviewInput(fields, { customer: "甲", amount: "0", ...structured });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.fieldIndex).toBeNull();
    expect(result.issues[0]?.error).toMatch(/保留字段名|嵌套|数据项/);
  });

  it("多字段合计超出共享输入大小时显示整体问题，不判为格式通过", () => {
    const many = AgentInputContract.parse({ fields: Array.from({ length: 40 }, (_, index) => ({ name: `field_${index}`, type: "string", required: true })) }).fields;
    const values = Object.fromEntries(many.map((field) => [field.name, "核".repeat(1000)]));
    const inspected = inspectPreviewInput(many, values);
    expect(inspected.issues).toEqual([{ fieldIndex: null, error: "运行输入不能超过 100 KB" }]);
    expect(checkPreviewInput(many, values)).toEqual({ ok: false, error: "运行输入不能超过 100 KB" });
  });
});
