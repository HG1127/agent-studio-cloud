import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebToolLayoutPreview } from "@/features/web-tools/WebToolLayoutPreview";
import { createWebToolDesignDraft, type WebToolDesignDraft, type WebToolDesignField } from "@/features/web-tools/web-tool-design-draft";

function field(id: string, label: string, type: WebToolDesignField["type"] = "string", required = true): WebToolDesignField {
  return { id, name: id, label, type, required, rows: 3, placeholder: "", description: "" };
}

function design(fields: WebToolDesignField[]): WebToolDesignDraft {
  return { ...createWebToolDesignDraft(), name: "组件回归用设计", fields };
}

function EditablePreview({ draft }: { draft: WebToolDesignDraft }) {
  const [values, setValues] = useState<Record<string, string>>({});
  return <WebToolLayoutPreview draft={draft} values={values} onValueChange={(id, value) => setValues((current) => ({ ...current, [id]: value }))} />;
}

beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => {
  try { expect(fetch).not.toHaveBeenCalled(); }
  finally { vi.unstubAllGlobals(); }
});

describe("网页工具布局预览的逐项填写反馈", () => {
  it("一次标出全部缺项，首错误聚焦且帮助与错误说明共同关联", async () => {
    const user = userEvent.setup();
    const first = { ...field("brief", "业务正文"), description: "请提供完整业务资料。" };
    render(<WebToolLayoutPreview draft={design([first, field("confirm", "是否确认", "boolean")])} values={{}} onValueChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "检查填写" }));
    const input = screen.getByRole("textbox", { name: "业务正文（必填）" });
    const choice = screen.getByRole("combobox", { name: "是否确认（必填）" });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-required", "true");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("请提供完整业务资料。 请填写这一项。");
    expect(choice).toHaveAttribute("aria-invalid", "true");
    expect(choice).toHaveAccessibleDescription("请填写这一项。");
    expect(screen.getByRole("alert")).toHaveTextContent("有 2 项需要修改");
    expect(screen.getByRole("alert")).toHaveTextContent("不会发起运行");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("相同错误反复检查和键盘重新检查都定位首项，不修改填写", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    render(<WebToolLayoutPreview draft={design([field("brief", "业务正文")])} values={{ brief: "  " }} onValueChange={changed} />);
    const button = screen.getByRole("button", { name: "检查填写" });
    const input = screen.getByRole("textbox", { name: "业务正文（必填）" });
    await user.click(button);
    expect(input).toHaveFocus();
    await user.click(button);
    expect(input).toHaveFocus();
    button.focus();
    await user.keyboard("{Enter}");
    expect(input).toHaveFocus();
    expect(input).toHaveValue("  ");
    expect(changed).not.toHaveBeenCalled();
  });

  it("首次与重复聚焦发生时，本次错误标记及关联说明已经提交", async () => {
    const user = userEvent.setup();
    render(<WebToolLayoutPreview draft={design([{ ...field("brief", "业务正文"), description: "原填写帮助。" }])} values={{}} onValueChange={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: "业务正文（必填）" });
    const observed: { invalid: string | null; descriptions: (string | null | undefined)[] }[] = [];
    input.addEventListener("focus", () => {
      observed.push({ invalid: input.getAttribute("aria-invalid"), descriptions: (input.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent) });
    });
    await user.click(screen.getByRole("button", { name: "检查填写" }));
    await user.click(screen.getByRole("button", { name: "检查填写" }));
    expect(observed).toEqual([
      { invalid: "true", descriptions: ["原填写帮助。", "请填写这一项。"] },
      { invalid: "true", descriptions: ["原填写帮助。", "请填写这一项。"] },
    ]);
  });

  it("修改后撤下旧错误，重新检查正确填写只报告本地检查完成", async () => {
    const user = userEvent.setup();
    render(<EditablePreview draft={design([field("brief", "业务正文")])} />);
    const input = screen.getByRole("textbox", { name: "业务正文（必填）" });
    await user.click(screen.getByRole("button", { name: "检查填写" }));
    expect(input).toHaveAttribute("aria-invalid", "true");
    await user.type(input, "第一行资料\n第二行资料");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).not.toHaveAttribute("aria-describedby");
    await user.click(screen.getByRole("button", { name: "检查填写" }));
    expect(screen.getByRole("status")).toHaveTextContent("未发起运行，也没有生成结果");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(input).toHaveValue("第一行资料\n第二行资料");
  });

  it("空选填、零、小数、否及正确结构保留原值，不误判成缺项", async () => {
    const user = userEvent.setup();
    const changed = vi.fn();
    const fields = [field("optional", "补充资料", "string", false), field("zero", "零值", "number"),
      field("decimal", "小数", "number"), field("boolean", "是否采用", "boolean"),
      field("object", "明细对象", "object"), field("array", "明细列表", "array")];
    const values = { optional: "  ", zero: "0", decimal: "0.25", boolean: "false", object: "{}", array: "[]" };
    render(<WebToolLayoutPreview draft={design(fields)} values={values} onValueChange={changed} />);
    await user.click(screen.getByRole("button", { name: "检查填写" }));
    expect(screen.getByRole("status")).toHaveTextContent("本页填写检查完成");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "零值（必填）" })).toHaveValue(0);
    expect(screen.getByRole("spinbutton", { name: "小数（必填）" })).toHaveValue(0.25);
    expect(screen.getByRole("spinbutton", { name: "小数（必填）" })).toHaveAttribute("step", "any");
    expect(screen.getByRole("combobox", { name: "是否采用（必填）" })).toHaveValue("false");
    expect(screen.getByRole("textbox", { name: "补充资料（选填）" })).toHaveValue("  ");
    expect(changed).not.toHaveBeenCalled();
  });

  it.each([
    ["object", "[]", "对象"], ["object", "null", "对象"], ["object", "{未闭合", "对象"],
    ["array", "{}", "列表"], ["array", "1", "列表"], ["array", "[未闭合", "列表"],
  ] as const)("%s 类型的错误填写 %s 给出可操作提示且定位对应项", async (type, value, expected) => {
    const user = userEvent.setup();
    render(<WebToolLayoutPreview draft={design([field("details", "明细", type)])} values={{ details: value }} onValueChange={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: "明细（必填）" });
    await user.click(screen.getByRole("button", { name: "检查填写" }));
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(new RegExp("只用于本页检查。 请填写结构化" + expected));
    expect(screen.getByRole("alert")).toHaveTextContent("有 1 项需要修改");
    expect(input).toHaveValue(value);
  });

  it("非有限数字与非法是或否不报告检查通过", async () => {
    const user = userEvent.setup();
    render(<WebToolLayoutPreview draft={design([field("amount", "数量", "number"), field("choice", "是否采用", "boolean")])}
      values={{ amount: "1e309", choice: "yes" }} onValueChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "检查填写" }));
    expect(screen.getByRole("spinbutton", { name: "数量（必填）" })).toHaveFocus();
    expect(screen.getByRole("spinbutton", { name: "数量（必填）" })).toHaveAccessibleDescription("请填写有效数字。");
    expect(screen.getByRole("combobox", { name: "是否采用（必填）" })).toHaveAccessibleDescription("请选择是或否。");
    expect(screen.getByRole("alert")).toHaveTextContent("有 2 项需要修改");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("字段排序、移除和改类型使旧反馈失效，下一次定位当前首缺项", async () => {
    const user = userEvent.setup();
    const first = field("first", "第一项");
    const second = field("second", "第二项");
    const changed = vi.fn();
    const view = render(<WebToolLayoutPreview draft={design([first, second])} values={{}} onValueChange={changed} />);
    await user.click(screen.getByRole("button", { name: "检查填写" }));
    view.rerender(<WebToolLayoutPreview draft={design([second, first])} values={{}} onValueChange={changed} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "检查填写" }));
    expect(screen.getByRole("textbox", { name: "第二项（必填）" })).toHaveFocus();
    view.rerender(<WebToolLayoutPreview draft={design([{ ...second, type: "boolean" }])} values={{}} onValueChange={changed} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "第一项（必填）" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "检查填写" }));
    expect(screen.getByRole("combobox", { name: "第二项（必填）" })).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent("有 1 项需要修改");
  });

  it("字段改回原定义不恢复旧错误或抢焦点，必须明确重新检查", async () => {
    const user = userEvent.setup();
    const original = field("details", "明细", "object");
    const changed = vi.fn();
    const view = render(<WebToolLayoutPreview draft={design([original])} values={{ details: "未应用正文" }} onValueChange={changed} />);
    await user.click(screen.getByRole("button", { name: "检查填写" }));
    const button = screen.getByRole("button", { name: "检查填写" });
    button.focus();
    view.rerender(<WebToolLayoutPreview draft={design([{ ...original, type: "string" }])} values={{ details: "未应用正文" }} onValueChange={changed} />);
    view.rerender(<WebToolLayoutPreview draft={design([original])} values={{ details: "未应用正文" }} onValueChange={changed} />);
    expect(button).toHaveFocus();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "明细（必填）" })).not.toHaveAttribute("aria-invalid");
    await user.click(button);
    expect(screen.getByRole("textbox", { name: "明细（必填）" })).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent("有 1 项需要修改");
    expect(screen.getByRole("textbox", { name: "明细（必填）" })).toHaveValue("未应用正文");
  });

  it("两份预览的错误、说明编号与焦点隔离，另一份填写保持", async () => {
    const user = userEvent.setup();
    const draft = design([field("same", "同名输入")]);
    render(<div><section aria-label="第一份预览"><WebToolLayoutPreview draft={draft} values={{ same: "保留的正文" }} onValueChange={vi.fn()} /></section>
      <section aria-label="第二份预览"><WebToolLayoutPreview draft={draft} values={{}} onValueChange={vi.fn()} /></section></div>);
    const first = within(screen.getByRole("region", { name: "第一份预览" }));
    const second = within(screen.getByRole("region", { name: "第二份预览" }));
    await user.click(second.getByRole("button", { name: "检查填写" }));
    expect(second.getByRole("textbox", { name: "同名输入（必填）" })).toHaveFocus();
    expect(first.getByRole("textbox", { name: "同名输入（必填）" })).toHaveValue("保留的正文");
    expect(first.getByRole("textbox", { name: "同名输入（必填）" })).not.toHaveAttribute("aria-invalid");
    expect(first.queryByRole("alert")).not.toBeInTheDocument();
    expect(first.getByRole("textbox").id).not.toBe(second.getByRole("textbox").id);
  });

  it("预览分区往返保留填写和已检查错误，不生成业务成果", async () => {
    const user = userEvent.setup();
    render(<WebToolLayoutPreview draft={design([field("brief", "业务正文")])} values={{}} onValueChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "检查填写" }));
    await user.click(screen.getByRole("tab", { name: "结果布局" }));
    expect(screen.getByText("尚未启用结果模块。真实运行后显示业务结果。")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "输入表单" }));
    expect(screen.getByRole("textbox", { name: "业务正文（必填）" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "业务正文（必填）" })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("不会发起运行");
  });

  it("没有输入项时只检查空布局，不生成示例资料或运行结果", async () => {
    const user = userEvent.setup();
    render(<WebToolLayoutPreview draft={design([])} values={{}} onValueChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "检查填写" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("没有生成结果");
    expect(screen.getByText("尚未设计输入项，可在左侧添加；没有生成示例数据。")).toBeVisible();
  });
});
