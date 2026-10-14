import { StrictMode, useRef, useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentInputField } from "@/contracts/manifest";
import { StructuredInputEditor } from "@/features/inputs/StructuredInputEditor";

const objectField = AgentInputField.parse({ name: "details", type: "object", label: "业务资料" });
const arrayField = AgentInputField.parse({ name: "records", type: "array", label: "业务记录" });
const calls = { apply: vi.fn(), pending: vi.fn(), submit: vi.fn() };
function Host({ field = arrayField, initial = '[{"count":0,"confirmed":false,"说明":"原文"}]', disabled = false, allowApply = true }: {
  field?: AgentInputField; initial?: string; disabled?: boolean; allowApply?: boolean;
}) {
  const [source, setSource] = useState({ value: initial, revision: 0 });
  const current = useRef(source);
  const token = useRef<{ owner: string; revision: number } | null>(null);
  const [pending, setPending] = useState(false);
  function replace(value: string) {
    current.current = { value, revision: current.current.revision + 1 };
    token.current = null; setPending(false); setSource(current.current);
  }
  return <form aria-label="受控父表单" onSubmit={(event) => { event.preventDefault(); calls.submit(); }}>
    <label>父层原始数据<textarea aria-label="父层原始数据" value={source.value} onChange={(event) => replace(event.target.value)} /></label>
    <output aria-label="父层修订">{source.revision}</output><output aria-label="父层草稿状态">{pending ? "有未应用草稿" : "没有未应用草稿"}</output>
    <StructuredInputEditor field={field} label={field.label!} value={source.value} revision={source.revision} disabled={disabled}
      onApply={(text, expected) => {
        calls.apply(text, expected);
        if (!allowApply || disabled || expected !== current.current.revision || token.current?.revision !== expected) return false;
        replace(text); return true;
      }}
      onPendingChange={(owner, revision, next) => {
        calls.pending(owner, revision, next);
        if (revision !== current.current.revision) return;
        if (next) { token.current = { owner, revision }; setPending(true); }
        else if (token.current?.owner === owner && token.current.revision === revision) { token.current = null; setPending(false); }
      }} />
  </form>;
}
function editor(label = "业务记录") { return screen.getByRole("region", { name: label + "结构化录入" }); }
function raw() { return screen.getByLabelText("父层原始数据") as HTMLTextAreaElement; }
async function openImport(label = "业务记录") {
  await userEvent.click(within(editor(label)).getByRole("button", { name: "从表格或本地文件导入" }));
}
function paste(text: string, label = "业务记录") { fireEvent.change(screen.getByLabelText("粘贴" + label + "资料"), { target: { value: text } }); }
function deferredFile(name: string) {
  let resolve!: (value: string) => void, reject!: (reason: Error) => void;
  const promise = new Promise<string>((done, fail) => { resolve = done; reject = fail; });
  const read = vi.fn(() => promise);
  const file = new File(["本地占位文本"], name, { type: "text/plain" });
  Object.defineProperty(file, "text", { value: read });
  return { file, read, resolve, reject };
}
function choose(file: File, label = "业务记录") { fireEvent.change(screen.getByLabelText("导入" + label + "本地文件"), { target: { files: [file] } }); }
beforeEach(() => { calls.apply.mockReset(); calls.pending.mockReset(); calls.submit.mockReset(); });

describe("真实受控结构化编辑器与父修订交接", () => {
  it("原值类型编辑暂存先同步pending，应用成功实际改变父value/revision，其余零和否保留", async () => {
    render(<Host />);
    const edit = within(editor()).getByRole("button", { name: "编辑业务记录第 1 条的count" });
    act(() => { fireEvent.click(edit); expect(calls.pending).toHaveBeenCalledTimes(1); expect(calls.pending.mock.calls[0][2]).toBe(true); });
    expect(screen.getByLabelText("父层草稿状态")).toHaveTextContent("有未应用草稿");
    const control = screen.getByLabelText("业务记录本次编辑内容");
    fireEvent.change(control, { target: { value: "12x" } });
    await userEvent.click(screen.getByRole("button", { name: "应用单元格编辑" }));
    expect(screen.getByRole("alert")).toHaveTextContent("有限的数字"); expect(calls.apply).not.toHaveBeenCalled();
    expect(JSON.parse(raw().value)).toEqual([{ count: 0, confirmed: false, 说明: "原文" }]); expect(control).toHaveValue("12x");
    fireEvent.change(control, { target: { value: "2" } });
    const apply = screen.getByRole("button", { name: "应用单元格编辑" });
    act(() => { fireEvent.click(apply); fireEvent.click(apply); });
    expect(calls.apply).toHaveBeenCalledOnce(); expect(calls.apply.mock.calls[0][1]).toBe(0);
    expect(JSON.parse(raw().value)).toEqual([{ count: 2, confirmed: false, 说明: "原文" }]);
    expect(screen.getByLabelText("父层修订")).toHaveTextContent("1");
    expect(screen.getByLabelText("父层草稿状态")).toHaveTextContent("没有未应用草稿");
    expect(calls.pending.mock.calls.every((call) => typeof call[0] === "string" && call[1] === 0)).toBe(true);
    expect(editor()).not.toHaveTextContent(calls.pending.mock.calls[0][0]); expect(calls.submit).not.toHaveBeenCalled();
  });

  it("父拒绝应用保留可见草稿；父条件允许后再次人工应用仍按原修订交接", async () => {
    const view = render(<Host allowApply={false} />); await openImport(); paste("业务,编号\n甲,001\n乙,0");
    await userEvent.click(screen.getByRole("button", { name: "预览导入" }));
    await userEvent.click(screen.getByRole("button", { name: "确认替换当前资料" }));
    expect(screen.getByRole("alert")).toHaveTextContent("未应用到原输入"); expect(screen.getByLabelText("粘贴业务记录资料")).toHaveValue("业务,编号\n甲,001\n乙,0");
    expect(screen.getByLabelText("父层修订")).toHaveTextContent("0"); expect(raw()).toHaveValue('[{"count":0,"confirmed":false,"说明":"原文"}]');
    expect(screen.getByLabelText("父层草稿状态")).toHaveTextContent("有未应用草稿");
    view.rerender(<Host allowApply />);
    expect(calls.apply).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "确认替换当前资料" }));
    expect(calls.apply).toHaveBeenCalledTimes(2); expect(calls.apply.mock.calls.map((call) => call[1])).toEqual([0, 0]);
    expect(JSON.parse(raw().value)).toEqual([{ 业务: "甲", 编号: "001" }, { 业务: "乙", 编号: "0" }]);
    expect(screen.getByLabelText("父层修订")).toHaveTextContent("1");
  });

  it("对象新增业务字段由用户明确选类型，取消不写；列表添行删行只在确认后改变父值", async () => {
    const view = render(<Host field={objectField} initial='{"原资料":"保留"}' />);
    await userEvent.click(within(editor("业务资料")).getByRole("button", { name: "添加业务字段" }));
    fireEvent.change(screen.getByLabelText("业务资料新增业务字段名称"), { target: { value: "确认" } });
    fireEvent.change(screen.getByLabelText("业务资料新内容类型"), { target: { value: "boolean" } });
    fireEvent.change(screen.getByLabelText("业务资料本次编辑内容"), { target: { value: "false" } });
    expect(raw()).toHaveValue('{"原资料":"保留"}');
    await userEvent.click(screen.getByRole("button", { name: "添加字段到原输入" }));
    expect(JSON.parse(raw().value)).toEqual({ 原资料: "保留", 确认: false }); expect(screen.getByLabelText("父层修订")).toHaveTextContent("1");
    await userEvent.click(within(editor("业务资料")).getByRole("button", { name: "添加业务字段" }));
    fireEvent.change(screen.getByLabelText("业务资料新增业务字段名称"), { target: { value: "不得加入" } });
    await userEvent.click(screen.getByRole("button", { name: "取消本次编辑" }));
    expect(JSON.parse(raw().value)).toEqual({ 原资料: "保留", 确认: false });
    view.unmount(); render(<Host initial="[0,false]" />);
    await userEvent.click(within(editor()).getByRole("button", { name: "添加一条" }));
    fireEvent.change(screen.getByLabelText("业务记录新内容类型"), { target: { value: "object" } });
    fireEvent.change(screen.getByLabelText("业务记录本次编辑内容"), { target: { value: '{"金额":0,"确认":false}' } });
    await userEvent.click(screen.getByRole("button", { name: "添加条目到原输入" }));
    expect(JSON.parse(raw().value)).toEqual([0, false, { 金额: 0, 确认: false }]);
    await userEvent.click(screen.getByRole("button", { name: "删除业务记录第 2 条" })); expect(JSON.parse(raw().value)).toHaveLength(3);
    await userEvent.click(screen.getByRole("button", { name: "取消本次编辑" })); expect(JSON.parse(raw().value)).toHaveLength(3);
    await userEvent.click(screen.getByRole("button", { name: "删除业务记录第 2 条" })); await userEvent.click(screen.getByRole("button", { name: "确认删除这条" }));
    expect(JSON.parse(raw().value)).toEqual([0, { 金额: 0, 确认: false }]);
  });

  it("当前无效JSON仅解释未知；显式导入后预览前3条、确认完整4条，取消或错误不替换", async () => {
    render(<Host initial="{invalid" />);
    expect(editor()).toHaveTextContent("没有把它当成空对象或空列表");
    expect(within(editor()).queryByRole("status")).not.toBeInTheDocument(); expect(calls.pending).not.toHaveBeenCalled();
    await openImport(); paste("资料,确认\n甲,false\n乙,true\n丙,0\n丁,001");
    await userEvent.click(screen.getByRole("button", { name: "预览导入" }));
    const preview = screen.getByLabelText("业务记录导入内容预览（数据格式）");
    expect(preview).toHaveTextContent("丙"); expect(preview).not.toHaveTextContent("丁");
    expect(raw()).toHaveValue("{invalid"); expect(calls.apply).not.toHaveBeenCalled();
    paste("甲,乙\n无法解析列数"); await userEvent.click(screen.getByRole("button", { name: "预览导入" }));
    expect(screen.getByRole("alert")).toHaveTextContent("列数与表头不一致");
    expect(screen.queryByLabelText("业务记录导入内容预览（数据格式）")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "取消导入" }));
    expect(raw()).toHaveValue("{invalid"); expect(calls.apply).not.toHaveBeenCalled();
    await openImport(); paste("资料,确认\n甲,false\n乙,true\n丙,0\n丁,001");
    await userEvent.click(screen.getByRole("button", { name: "预览导入" }));
    await userEvent.click(screen.getByRole("button", { name: "确认替换当前资料" }));
    expect(JSON.parse(raw().value)).toEqual([{ 资料: "甲", 确认: "false" }, { 资料: "乙", 确认: "true" }, { 资料: "丙", 确认: "0" }, { 资料: "丁", 确认: "001" }]);
    expect(screen.getByLabelText("父层修订")).toHaveTextContent("1");
  });

  it("50行分页不删实际记录，连续翻页越界后可回第一页，查看不产生草稿或提交", async () => {
    const values = Array.from({ length: 60 }, (_, index) => ({ 编号: index, 确认: false }));
    render(<Host initial={JSON.stringify(values)} />);
    const table = () => screen.getByRole("table", { name: "业务记录当前记录" });
    expect(within(table()).getAllByRole("row")).toHaveLength(51);
    const next = screen.getByRole("button", { name: "下一页记录" });
    act(() => { fireEvent.click(next); fireEvent.click(next); });
    expect(editor()).toHaveTextContent("当前页已没有记录");
    await userEvent.click(screen.getByRole("button", { name: "回到记录第一页" }));
    expect(within(table()).getAllByRole("row")).toHaveLength(51);
    await userEvent.click(screen.getByRole("button", { name: "下一页记录" }));
    expect(within(table()).getAllByRole("row")).toHaveLength(11); expect(editor()).toHaveTextContent("第 60 条");
    expect(JSON.parse(raw().value)).toEqual(values); expect(calls.pending).not.toHaveBeenCalled(); expect(calls.apply).not.toHaveBeenCalled(); expect(calls.submit).not.toHaveBeenCalled();
  });

  it("所有操作是typebutton且无嵌套form，静态说明不冒称操作回执或运行通过", () => {
    render(<Host initial="" />);
    expect(screen.getAllByRole("form")).toHaveLength(1);
    for (const button of within(editor()).getAllByRole("button")) expect(button).toHaveAttribute("type", "button");
    expect(within(editor()).queryByRole("status")).not.toBeInTheDocument();
    expect(editor()).toHaveTextContent("原输入为空"); expect(editor()).not.toHaveTextContent("通过业务验收");
    expect(calls.apply).not.toHaveBeenCalled(); expect(calls.pending).not.toHaveBeenCalled();
  });
});

describe("本地文件与旧草稿归属的真实生命周期", () => {
  it("StrictMode 外部 A→B→A 修订后，两个旧文件的成功/失败都不覆盖新草稿或解锁新owner", async () => {
    render(<StrictMode><Host initial='[{"scope":"A"}]' /></StrictMode>);
    await openImport(); const oldA = deferredFile("a.json"); choose(oldA.file);
    expect(oldA.read).toHaveBeenCalledOnce();
    fireEvent.change(raw(), { target: { value: '[{"scope":"B"}]' } });
    await openImport(); const oldB = deferredFile("b.json"); choose(oldB.file);
    fireEvent.change(raw(), { target: { value: '[{"scope":"A"}]' } });
    await openImport(); paste("资料,编号\n新草稿,001");
    const pendingCalls = calls.pending.mock.calls.length;
    const newOwner = calls.pending.mock.calls.at(-1)!;
    expect(newOwner[1]).toBe(2); expect(newOwner[2]).toBe(true);
    await act(async () => { oldA.resolve('[{"scope":"旧A"}]'); oldB.reject(new Error("旧B私有错误")); });
    expect(calls.pending).toHaveBeenCalledTimes(pendingCalls);
    expect(screen.getByLabelText("父层草稿状态")).toHaveTextContent("有未应用草稿");
    expect(screen.getByLabelText("粘贴业务记录资料")).toHaveValue("资料,编号\n新草稿,001");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); expect(calls.apply).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "预览导入" }));
    await userEvent.click(screen.getByRole("button", { name: "确认替换当前资料" }));
    expect(calls.apply).toHaveBeenCalledOnce(); expect(calls.apply.mock.calls[0][1]).toBe(2);
    expect(JSON.parse(raw().value)).toEqual([{ 资料: "新草稿", 编号: "001" }]);
    expect(screen.getByLabelText("父层修订")).toHaveTextContent("3");
  });

  it("同一导入草稿再次选择文件，只接受最后一次读取且不自动应用", async () => {
    render(<Host />); await openImport();
    const first = deferredFile("first.csv"), second = deferredFile("second.json");
    choose(first.file); choose(second.file);
    await act(async () => second.resolve('[{"zero":0,"flag":false,"说明":"新文件"}]'));
    const preview = screen.getByLabelText("业务记录导入内容预览（数据格式）");
    expect(preview).toHaveTextContent('"zero": 0'); expect(preview).toHaveTextContent('"flag": false');
    const count = calls.pending.mock.calls.length;
    await act(async () => first.resolve("说明\n旧文件"));
    expect(preview).toHaveTextContent("新文件"); expect(preview).not.toHaveTextContent("旧文件");
    expect(calls.pending).toHaveBeenCalledTimes(count); expect(calls.apply).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "确认替换当前资料" }));
    expect(JSON.parse(raw().value)).toEqual([{ zero: 0, flag: false, 说明: "新文件" }]);
    expect(screen.getByLabelText("父层修订")).toHaveTextContent("1");
  });

  it("取消正在读取的文件后旧完成不能重登pending，也不替换后来粘贴的资料", async () => {
    render(<Host />); await openImport(); const old = deferredFile("old.txt"); choose(old.file);
    await userEvent.click(screen.getByRole("button", { name: "取消导入" }));
    expect(screen.getByLabelText("父层草稿状态")).toHaveTextContent("没有未应用草稿");
    await openImport(); paste("说明\n新粘贴资料");
    const count = calls.pending.mock.calls.length;
    await act(async () => old.resolve("说明\n旧文件资料"));
    expect(calls.pending).toHaveBeenCalledTimes(count);
    expect(screen.getByLabelText("粘贴业务记录资料")).toHaveValue("说明\n新粘贴资料");
    expect(screen.getByLabelText("父层草稿状态")).toHaveTextContent("有未应用草稿");
    expect(calls.apply).not.toHaveBeenCalled(); expect(raw()).toHaveValue('[{"count":0,"confirmed":false,"说明":"原文"}]');
  });

  it.each(["resolve", "reject"] as const)("disabled 提交阶段收到旧文件 %s 不写新UI或登记旧草稿，事件自身仍守卫", async (outcome) => {
    const view = render(<Host />); await openImport(); const old = deferredFile("pending.json"); choose(old.file);
    view.rerender(<Host disabled />);
    const count = calls.pending.mock.calls.length;
    fireEvent.click(within(editor()).getByRole("button", { name: "从表格或本地文件导入" }));
    await act(async () => { if (outcome === "resolve") old.resolve('[{"不得覆盖":"旧结果"}]'); else old.reject(new Error("旧错误")); });
    expect(calls.pending).toHaveBeenCalledTimes(count); expect(calls.apply).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("粘贴业务记录资料")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(raw()).toHaveValue('[{"count":0,"confirmed":false,"说明":"原文"}]');
    view.rerender(<Host />);
    expect(screen.queryByLabelText("粘贴业务记录资料")).not.toBeInTheDocument();
    expect(screen.getByLabelText("父层草稿状态")).toHaveTextContent("没有未应用草稿");
  });

  it("卸载后文件回执没有任何重新登记或应用，cleanup携原owner与原修订释放", async () => {
    const view = render(<Host />); await openImport(); const old = deferredFile("unmounted.json"); choose(old.file);
    const started = calls.pending.mock.calls[0]; view.unmount();
    expect(calls.pending.mock.calls.at(-1)).toEqual([started[0], 0, false]);
    const count = calls.pending.mock.calls.length;
    await act(async () => old.resolve('[{"late":true}]'));
    expect(calls.pending).toHaveBeenCalledTimes(count); expect(calls.apply).not.toHaveBeenCalled();
  });

  it("文件读取失败不透出异常、不应用；只保留草稿直到明确取消", async () => {
    render(<Host />); await openImport(); const failed = deferredFile("failure.json"); choose(failed.file);
    await act(async () => failed.reject(new Error("private-file-error")));
    expect(screen.getByRole("alert")).toHaveTextContent("本地文件暂时无法读取");
    expect(editor()).not.toHaveTextContent("private-file-error");
    expect(screen.getByLabelText("父层草稿状态")).toHaveTextContent("有未应用草稿");
    expect(calls.apply).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "取消导入" }));
    expect(screen.getByLabelText("父层草稿状态")).toHaveTextContent("没有未应用草稿"); expect(raw()).toHaveValue('[{"count":0,"confirmed":false,"说明":"原文"}]');
  });

  it.each(["oversize", "unsupported"] as const)("%s 本地文件在读取前拒绝，无截断或假附件能力", async (kind) => {
    render(<Host />); await openImport(); const selected = deferredFile(kind === "oversize" ? "large.csv" : "document.pdf");
    if (kind === "oversize") Object.defineProperty(selected.file, "size", { value: 2 * 1024 * 1024 + 1 });
    choose(selected.file);
    expect(selected.read).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(kind === "oversize" ? "本地 2MB 读取安全上限" : "不解析文档");
    expect(calls.apply).not.toHaveBeenCalled(); expect(screen.getByLabelText("父层修订")).toHaveTextContent("0");
    expect(screen.getByLabelText("父层草稿状态")).toHaveTextContent("有未应用草稿");
  });

  it("当前不合法原文只能通过明确空值预览和确认替换，不能初始化后自动应用", async () => {
    render(<Host field={objectField} initial="{broken" />);
    await userEvent.click(within(editor("业务资料")).getByRole("button", { name: "预览空对象替换" }));
    expect(raw()).toHaveValue("{broken"); expect(calls.apply).not.toHaveBeenCalled();
    expect(screen.getByLabelText("业务资料导入内容预览（数据格式）")).toHaveTextContent("{}");
    await userEvent.click(screen.getByRole("button", { name: "确认替换当前资料" }));
    expect(raw()).toHaveValue("{}"); expect(screen.getByLabelText("父层修订")).toHaveTextContent("1"); expect(calls.submit).not.toHaveBeenCalled();
  });
});
