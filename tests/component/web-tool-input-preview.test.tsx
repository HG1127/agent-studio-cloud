import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentInputField } from "@/contracts/manifest";
import { WebToolInputPreview } from "@/features/web-tools/WebToolInputPreview";
import { checkPreviewInput } from "@/features/web-tools/preview-input";

const fields: AgentInputField[] = [
  { name: "customer", label: "客户名称", required: true, type: "string" },
  { name: "amount", label: "金额", required: true, type: "number" },
  { name: "approved", label: "已批准", required: false, type: "boolean" },
  { name: "details", label: "补充信息", required: false, type: "object" },
  { name: "items", label: "明细", required: false, type: "array" },
];

afterEach(() => vi.unstubAllGlobals());

describe("网页工具输入预览", () => {
  it("按正式版本字段校验必填与类型，不生成或提交任务", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<WebToolInputPreview fields={fields} />);

    await user.click(screen.getByRole("button", { name: "检查填写格式" }));
    expect(screen.getByRole("status")).toHaveTextContent("请填写客户名称");
    await user.type(screen.getByRole("textbox", { name: /客户名称/ }), "演示客户");
    await user.type(screen.getByRole("textbox", { name: /金额/ }), "二十");
    await user.click(screen.getByRole("button", { name: "检查填写格式" }));
    expect(screen.getByRole("status")).toHaveTextContent("金额需要填写数字");
    await user.clear(screen.getByRole("textbox", { name: /金额/ }));
    await user.type(screen.getByRole("textbox", { name: /金额/ }), "20.5");
    await user.click(screen.getByRole("button", { name: "检查填写格式" }));
    expect(screen.getByRole("status")).toHaveTextContent("已核对 2 项填写格式；没有提交或运行任务");
    expect(screen.getByRole("status")).not.toHaveTextContent("演示客户");
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "清空试填" }));
    expect(screen.getByRole("textbox", { name: /客户名称/ })).toHaveValue("");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("结构化字段按对象或列表校验，空契约不提供试填提交", () => {
    expect(checkPreviewInput(fields, { customer: "甲", amount: "1", details: "[]" })).toEqual({ ok: false, error: "补充信息的结构格式不正确" });
    expect(checkPreviewInput(fields, { customer: "甲", amount: "1", details: "{}", items: "{}" })).toEqual({ ok: false, error: "明细的结构格式不正确" });
    expect(checkPreviewInput(fields, { customer: "甲", amount: "1", approved: "false", details: "{}", items: "[]" })).toEqual({ ok: true, checkedFields: 5 });
    render(<WebToolInputPreview fields={[]} />);
    expect(screen.getByText(/没有结构化输入字段/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "检查填写格式" })).not.toBeInTheDocument();
  });
});
