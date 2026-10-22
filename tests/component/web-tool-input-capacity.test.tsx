import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentInputContract } from "@/contracts/manifest";
import { AgentTargetOption } from "@/contracts/agent";
import { MAX_RUN_INPUT_BYTES, RunInputPayload } from "@/contracts/run";
import { WebToolInputPreview } from "@/features/web-tools/WebToolInputPreview";
import { preparePreviewInput, previewInputCapacity } from "@/features/web-tools/preview-input";

const { startRun, push } = vi.hoisted(() => ({ startRun: vi.fn(), push: vi.fn() }));
vi.mock("@/server/actions/start-run-task", () => ({ startRunTaskAction: startRun }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const fields = AgentInputContract.parse({ fields: [{ name: "body", label: "业务说明", type: "string", required: true }] }).fields;
const target = AgentTargetOption.parse({
  agentId: "00000000-0000-4000-8000-000000000921", agentName: "容量核对助手",
  versionId: "00000000-0000-4000-8000-000000000922", version: 2,
  inputContract: { fields }, outputContract: {},
});
const byteLength = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const overhead = byteLength({ body: "" });
function fill(text: string, label: string | RegExp = /业务说明/) {
  fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value: text } });
}
beforeEach(() => { startRun.mockReset(); push.mockReset(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("真实总输入容量", () => {
  it("超过四千字符的正文不再被截断，保留原文空白与多行", () => {
    const text = "  " + "说明".repeat(3500) + "\n末行原文  ";
    const prepared = preparePreviewInput(fields, { body: text });
    expect(prepared.input).toEqual({ body: text });
    expect(previewInputCapacity(fields, { body: text })).toBe(byteLength({ body: text }));
    expect(RunInputPayload.safeParse(prepared.input).success).toBe(true);
  });

  it("真实序列化负载恰好达到容量上限可用，超过一个字节即拦截", () => {
    const text = "a".repeat(MAX_RUN_INPUT_BYTES - overhead);
    expect(previewInputCapacity(fields, { body: text })).toBe(MAX_RUN_INPUT_BYTES);
    expect(preparePreviewInput(fields, { body: text }).input).toEqual({ body: text });
    expect(RunInputPayload.safeParse({ body: text }).success).toBe(true);
    const tooLarge = { body: text + "a" };
    expect(previewInputCapacity(fields, tooLarge)).toBe(MAX_RUN_INPUT_BYTES + 1);
    expect(RunInputPayload.safeParse(tooLarge).success).toBe(false);
    expect(preparePreviewInput(fields, tooLarge)).toMatchObject({
      input: null, issues: [{ fieldIndex: null, error: "全部输入合计不能超过 102400 字节；完整填写已保留，没有启动任务。" }],
    });
  });

  it.each(["文".repeat(35000), "😀".repeat(26000)])("中文或表情按真实编码容量计量，而非字符数量", (text) => {
    expect(text.length).toBeLessThan(MAX_RUN_INPUT_BYTES);
    expect(previewInputCapacity(fields, { body: text })).toBeGreaterThan(MAX_RUN_INPUT_BYTES);
    expect(preparePreviewInput(fields, { body: text }).input).toBeNull();
  });

  it("引号、换行、反斜线及字段名的实际序列化开销均进入总容量", () => {
    const text = '前缀"\n\\' + "尾".repeat(20) + "\u0000";
    const bytes = previewInputCapacity(fields, { body: text });
    expect(bytes).toBe(byteLength({ body: text }));
    expect(bytes).toBeGreaterThan(new TextEncoder().encode(text).byteLength);
    expect(preparePreviewInput(fields, { body: text }).input).toEqual({ body: text });
  });

  it("逐项都未超限但合计超限时拦截，不给每项单独分配一份总上限", () => {
    const two = AgentInputContract.parse({ fields: [
      fields[0], { name: "appendix", label: "补充说明", type: "string", required: true },
    ] }).fields;
    const values = { body: "a".repeat(MAX_RUN_INPUT_BYTES / 2), appendix: "b".repeat(MAX_RUN_INPUT_BYTES / 2) };
    expect(previewInputCapacity(two, values)).toBe(byteLength(values));
    expect(previewInputCapacity(two, values)).toBeGreaterThan(MAX_RUN_INPUT_BYTES);
    expect(preparePreviewInput(two, values).input).toBeNull();
  });

  it("按提交时的数字、否值、对象及列表计量，不把结构化编辑空白算成输入正文", () => {
    const typed = AgentInputContract.parse({ fields: [
      { name: "count", label: "数量", type: "number", required: true },
      { name: "approved", label: "已确认", type: "boolean", required: true },
      { name: "details", label: "详细内容", type: "object", required: true },
      { name: "items", label: "条目", type: "array", required: false },
      { name: "optional", label: "选填内容", type: "string", required: false },
    ] }).fields;
    const values = { count: "0".repeat(6000), approved: "false", details: JSON.stringify({ 说明: "文".repeat(4500), 数量: 0 }, null, 8), items: " [ 0, false ] ", optional: "", undeclared: "不计量".repeat(40000) };
    const actual = { count: 0, approved: false, details: { 说明: "文".repeat(4500), 数量: 0 }, items: [0, false] };
    expect(preparePreviewInput(typed, values).input).toEqual(actual);
    expect(previewInputCapacity(typed, values)).toBe(byteLength(actual));
  });

  it("缺必填或格式不完整时容量未知，不把可解析子集当完整输入", () => {
    expect(previewInputCapacity(fields, { body: "" })).toBeNull();
    const structured = [{ name: "details", label: "详细内容", type: "object" as const, required: true }];
    expect(previewInputCapacity(structured, { details: '{"未完成":' })).toBeNull();
    expect(preparePreviewInput(structured, { details: '{"未完成":' }).input).toBeNull();
  });

  it("容量以内仍沿用共享结构与保留名称限制，没有放宽后端输入规则", () => {
    const structured = [{ name: "details", label: "详细内容", type: "object" as const, required: true }];
    expect(preparePreviewInput(structured, { details: '{"constructor":"不能采用"}' }).input).toBeNull();
    const many = [{ name: "items", label: "条目", type: "array" as const, required: true }];
    const values = { items: JSON.stringify(Array.from({ length: 2001 }, () => 0)) };
    expect(previewInputCapacity(many, values)).toBeLessThan(MAX_RUN_INPUT_BYTES);
    expect(preparePreviewInput(many, values).input).toBeNull();
  });

  it("超深结构无法序列化时容量未知，仍由共享层级约束拦截而不崩溃", () => {
    const array = [{ name: "items", label: "条目", type: "array" as const, required: true }];
    const values = { items: "[".repeat(10000) + "0" + "]".repeat(10000) };
    expect(() => previewInputCapacity(array, values)).not.toThrow();
    expect(previewInputCapacity(array, values)).toBeNull();
    expect(preparePreviewInput(array, values).input).toBeNull();
    render(<WebToolInputPreview fields={array} />);
    fill(values.items, /条目/);
    expect(screen.getByRole("textbox", { name: /条目/ })).toHaveValue(values.items);
    expect(screen.getByLabelText("全部输入容量")).toHaveTextContent("才能计算全部输入的准确容量");
  });
});

describe("长输入试填与启动边界", () => {
  it("真实粘贴超过四千字符时完整保留，展开与布局切换不截断，格式检查不启动", async () => {
    const user = userEvent.setup();
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    render(<WebToolInputPreview fields={fields} trialTarget={target} />);
    const control = screen.getByRole("textbox", { name: /业务说明/ });
    expect(control).not.toHaveAttribute("maxlength");
    const text = "原说明\n" + "a".repeat(6500) + "\n保留结尾";
    await user.click(control); await user.paste(text);
    expect(control).toHaveValue(text);
    expect(screen.getByLabelText("全部输入容量")).toHaveTextContent("待提交输入占用 " + byteLength({ body: text }) + " / " + MAX_RUN_INPUT_BYTES + " 字节");
    await user.click(screen.getByRole("button", { name: "展开第 1 项填写区" }));
    await user.click(screen.getByRole("button", { name: "单列填写" }));
    await user.click(screen.getByRole("button", { name: "检查填写格式" }));
    expect(control).toHaveValue(text);
    expect(control).toHaveAttribute("rows", "8");
    expect(screen.getByRole("status")).toHaveTextContent("已核对 1 项填写格式");
    expect(startRun).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("超限中文保留完整原值，检查和试运行均不打开确认或调用动作", async () => {
    const user = userEvent.setup(); render(<WebToolInputPreview fields={fields} trialTarget={target} />);
    const text = "文".repeat(35000) + "\n真实末尾";
    fill(text);
    expect(screen.getByLabelText("全部输入容量")).toHaveTextContent("已超过总容量限制");
    expect(screen.getByLabelText("全部输入容量")).toHaveTextContent(String(byteLength({ body: text })));
    await user.click(screen.getByRole("button", { name: "检查填写格式" }));
    expect(screen.getByRole("status")).toHaveTextContent("完整填写已保留，没有启动任务");
    await user.click(screen.getByRole("button", { name: "用这些填写试运行" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /业务说明/ })).toHaveValue(text);
    expect(startRun).not.toHaveBeenCalled();
  });

  it("超限修改为容量内长文后重新核对，确认取消仍保留填写，只有另行确认才提交完整输入", async () => {
    startRun.mockResolvedValue({ ok: true, runId: "00000000-0000-4000-8000-000000000923" });
    const user = userEvent.setup(); render(<WebToolInputPreview fields={fields} trialTarget={target} />);
    fill("文".repeat(35000));
    await user.click(screen.getByRole("button", { name: "检查填写格式" }));
    const text = "  容量内正文\n" + "a".repeat(8000) + "\n末尾  ";
    fill(text);
    expect(screen.getByRole("status")).toHaveTextContent("已核对 1 项填写格式");
    expect(screen.getByLabelText("全部输入容量")).not.toHaveTextContent("已超过总容量限制");
    await user.click(screen.getByRole("button", { name: "用这些填写试运行" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "返回" }));
    expect(screen.getByRole("textbox", { name: /业务说明/ })).toHaveValue(text);
    expect(startRun).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "用这些填写试运行" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认并创建任务" }));
    expect(startRun).toHaveBeenCalledExactlyOnceWith({ agentId: target.agentId, versionId: target.versionId, input: { body: text }, requestId: expect.any(String) });
  });

  it("数字控件无单字段字符限制，长零值原填写保留而提交容量按数字零计算", async () => {
    const user = userEvent.setup();
    const numeric = [{ name: "count", label: "数量", type: "number" as const, required: true }];
    render(<WebToolInputPreview fields={numeric} />);
    const control = screen.getByRole("textbox", { name: /数量/ });
    expect(control).not.toHaveAttribute("maxlength");
    const text = "0".repeat(6000); fill(text, /数量/);
    await user.click(screen.getByRole("button", { name: "检查填写格式" }));
    expect(control).toHaveValue(text);
    expect(screen.getByLabelText("全部输入容量")).toHaveTextContent("待提交输入占用 " + byteLength({ count: 0 }));
    expect(screen.getByRole("status")).toHaveTextContent("已核对 1 项填写格式");
  });

  it("结构化长编辑区无字符截断，显示实际提交结构的总容量", async () => {
    const user = userEvent.setup();
    const structured = [{ name: "details", label: "详细内容", type: "object" as const, required: true }];
    render(<WebToolInputPreview fields={structured} />);
    const actual = { 说明: "文".repeat(4500), 标记: false };
    const text = JSON.stringify(actual, null, 8);
    const control = screen.getByRole("textbox", { name: /详细内容/ });
    expect(control).not.toHaveAttribute("maxlength"); fill(text, /详细内容/);
    await user.click(screen.getByRole("button", { name: "检查填写格式" }));
    expect(control).toHaveValue(text);
    expect(screen.getByLabelText("全部输入容量")).toHaveTextContent("待提交输入占用 " + byteLength({ details: actual }));
    expect(screen.getByRole("status")).toHaveTextContent("已核对 1 项填写格式");
  });

  it("不完整格式不会显示误导性容量数字，清空长文仍需确认并保留取消内容", async () => {
    const user = userEvent.setup(); render(<WebToolInputPreview fields={fields} />);
    expect(screen.getByLabelText("全部输入容量")).toHaveTextContent("才能计算全部输入的准确容量");
    const text = "a".repeat(8000); fill(text);
    await user.click(screen.getByRole("button", { name: "清空试填" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "返回" }));
    expect(screen.getByRole("textbox", { name: /业务说明/ })).toHaveValue(text);
    await user.click(screen.getByRole("button", { name: "清空试填" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认清空试填" }));
    expect(screen.getByRole("textbox", { name: /业务说明/ })).toHaveValue("");
    expect(screen.getByLabelText("全部输入容量")).toHaveTextContent("才能计算全部输入的准确容量");
    expect(startRun).not.toHaveBeenCalled();
  });
});
