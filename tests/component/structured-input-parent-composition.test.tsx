import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentTargetOption } from "@/contracts/agent";
import type { AgentInputField } from "@/contracts/manifest";
import type { RunTaskStartInput } from "@/contracts/run-task";
import type { StartRunResult } from "@/contracts/run";
import { RunLauncher } from "@/features/agents/RunLauncher";
import { WebToolInputPreview } from "@/features/web-tools/WebToolInputPreview";

const { start, push } = vi.hoisted(() => ({ start: vi.fn<(input: RunTaskStartInput) => Promise<StartRunResult>>(), push: vi.fn() }));
vi.mock("@/server/actions/start-run-task", () => ({ startRunTaskAction: start }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const fields: AgentInputField[] = [
  { name: "items", label: "业务清单", type: "array", required: true },
  { name: "details", label: "业务对象", type: "object", required: false },
  { name: "brief", label: "业务正文", type: "string", required: true },
];
const target = AgentTargetOption.parse({ agentId: "00000000-0000-4000-8000-000000000001", agentName: "结构资料助手", versionId: "00000000-0000-4000-8000-000000000002", version: 3, inputContract: { fields }, outputContract: {} });
const requestId = "00000000-0000-4000-8000-000000000004";
const runId = "00000000-0000-4000-8000-000000000005";
const csv = '员工编号,已核对\r\n001,false\r\n002,0';
const expectedRows = [{ 员工编号: "001", 已核对: "false" }, { 员工编号: "002", 已核对: "0" }];
type Surface = "agent" | "web";
function view(surface: Surface, selected = target) {
  return surface === "agent" ? <RunLauncher agentId={selected.agentId} productionVersionId={selected.versionId} inputFields={fields} productionVersion={selected.version} /> : <WebToolInputPreview fields={fields} trialTarget={selected} />;
}
function raw(label = "业务清单（必填）") { return screen.getByRole("textbox", { name: label }) as HTMLTextAreaElement; }
function editor(label = "业务清单") { return within(screen.getByRole("region", { name: `${label}结构化录入` })); }
function fillOriginal() {
  fireEvent.change(raw(), { target: { value: "[0,false]" } });
  fireEvent.change(raw("业务正文（必填）"), { target: { value: "  第一行\n第二行原文  " } });
}
function importDraft() {
  fireEvent.click(editor().getByRole("button", { name: "从表格或本地文件导入" }));
  fireEvent.change(editor().getByLabelText("粘贴业务清单资料", { exact: true }), { target: { value: csv } });
  fireEvent.click(editor().getByRole("button", { name: "预览导入" }));
}
async function confirmRun(surface: Surface) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: surface === "agent" ? "开始试运行" : "用这些填写试运行" }));
  if (surface === "web") await user.click(within(screen.getByRole("dialog", { name: "确认创建真实试运行？" })).getByRole("button", { name: "确认并创建任务" }));
}
beforeEach(() => { start.mockReset(); push.mockReset(); vi.spyOn(crypto, "randomUUID").mockReturnValue(requestId); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("真实助手与网页父组件挂载共享结构录入", () => {
  it.each(["agent", "web"] as const)("%s 未确认导入只保留本地草稿，准备输入前拦截且不生成nonce，取消不替换原填写", async (surface) => {
    render(view(surface)); fillOriginal(); importDraft();
    expect(raw()).toHaveValue("[0,false]");
    expect(editor().getByLabelText("业务清单导入内容预览（数据格式）")).toHaveTextContent("001");
    if (surface === "agent") fireEvent.submit(raw().closest("form")!);
    else fireEvent.click(screen.getByRole("button", { name: "用这些填写试运行" }));
    expect(surface === "agent" ? within(screen.getByRole("alert")).getByText(/业务清单还有尚未应用的填写/)
      : screen.getByRole("button", { name: "业务清单还有尚未应用的填写。请确认应用或取消该项草稿；没有提交任务。" })).toBeVisible();
    if (surface === "web") {
      const control = raw();
      expect(control).toHaveAttribute("aria-invalid", "true");
      const descriptions = (control.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent);
      expect(descriptions).toContain("业务清单还有尚未应用的填写。请确认应用或取消该项草稿；没有提交任务。");
    }
    expect(raw()).toHaveFocus();
    expect(start).not.toHaveBeenCalled(); expect(crypto.randomUUID).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(editor().getByRole("button", { name: "取消导入" }));
    expect(screen.queryByText(/业务清单还有尚未应用的填写/)).not.toBeInTheDocument();
    expect(raw()).toHaveValue("[0,false]");
    expect(raw("业务正文（必填）")).toHaveValue("  第一行\n第二行原文  ");
    expect(start).not.toHaveBeenCalled();
  });

  it.each(["agent", "web"] as const)("%s 真正接受后保留导入字符串和其他原文，真实动作只提交固定版本的完整四字段", async (surface) => {
    start.mockResolvedValueOnce({ ok: true, runId });
    render(view(surface)); fillOriginal(); importDraft();
    fireEvent.click(editor().getByRole("button", { name: "确认替换当前资料" }));
    expect(JSON.parse(raw().value)).toEqual(expectedRows);
    expect(screen.getByLabelText("结构化填写状态")).toHaveTextContent("尚未提交任务或保存版本");
    expect(start).not.toHaveBeenCalled(); expect(crypto.randomUUID).not.toHaveBeenCalled();
    await confirmRun(surface);
    await waitFor(() => expect(start).toHaveBeenCalledExactlyOnceWith({ agentId: target.agentId, versionId: target.versionId, input: { items: expectedRows, brief: "  第一行\n第二行原文  " }, requestId }));
    expect(Object.keys(start.mock.calls[0][0]).sort()).toEqual(["agentId", "input", "requestId", "versionId"]);
    expect(push).toHaveBeenCalledOnce();
    if (surface === "agent") expect(editor().getByRole("button", { name: "从表格或本地文件导入" })).toBeDisabled();
    else {
      expect(editor().getByRole("button", { name: "从表格或本地文件导入" })).toBeEnabled();
      expect(screen.queryByRole("button", { name: "用这些填写试运行" })).not.toBeInTheDocument();
      expect(screen.getByRole("link", { name: "打开本次任务详情" })).toBeVisible();
      expect(start).toHaveBeenCalledOnce();
    }
  });

  it.each(["agent", "web"] as const)("%s 合计容量拒绝应用后，完整原填写和导入预览保留且不能启动", (surface) => {
    render(view(surface)); fillOriginal();
    fireEvent.change(raw("业务正文（必填）"), { target: { value: "文".repeat(20000) } });
    fireEvent.click(editor().getByRole("button", { name: "从表格或本地文件导入" }));
    fireEvent.change(editor().getByLabelText("粘贴业务清单资料"), { target: { value: JSON.stringify(["料".repeat(20000)]) } });
    fireEvent.click(editor().getByRole("button", { name: "预览导入" }));
    fireEvent.click(editor().getByRole("button", { name: "确认替换当前资料" }));
    expect(raw()).toHaveValue("[0,false]");
    expect(raw("业务正文（必填）")).toHaveValue("文".repeat(20000));
    expect(editor().getByLabelText("粘贴业务清单资料")).toHaveValue(JSON.stringify(["料".repeat(20000)]));
    expect(editor().getByRole("alert")).toHaveTextContent("草稿仍保留");
    expect(screen.getAllByRole("alert").some((notice) => notice.textContent?.includes("100 KB"))).toBe(true);
    expect(start).not.toHaveBeenCalled(); expect(crypto.randomUUID).not.toHaveBeenCalled();
  });

  it.each(["agent", "web"] as const)("%s 专业填写ABA后旧文件读取不能回填或创建新的pending，严格模式仍可继续输入", async (surface) => {
    let finish!: (text: string) => void;
    const file = new File(["旧资料"], "业务.csv", { type: "text/csv" });
    Object.defineProperty(file, "text", { value: () => new Promise<string>((resolve) => { finish = resolve; }) });
    render(<StrictMode>{view(surface)}</StrictMode>); fillOriginal();
    fireEvent.click(editor().getByRole("button", { name: "从表格或本地文件导入" }));
    fireEvent.change(editor().getByLabelText("导入业务清单本地文件"), { target: { files: [file] } });
    expect(editor().getByRole("status")).toHaveTextContent("正在读取本地文本");
    fireEvent.change(raw(), { target: { value: "[1]" } });
    fireEvent.change(raw(), { target: { value: "[0,false]" } });
    await act(async () => finish(csv));
    expect(raw()).toHaveValue("[0,false]");
    expect(screen.queryByText(/项本地填写尚未应用/)).not.toBeInTheDocument();
    expect(editor().queryByLabelText("业务清单导入内容预览（数据格式）")).not.toBeInTheDocument();
    expect(start).not.toHaveBeenCalled();
  });

  it("真实对象单元格与新增字段编辑只改本项，原零、否、空值、嵌套及另一个列表仍保留", () => {
    render(view("agent")); fillOriginal();
    const details = { 数量: 0, 已核对: false, 未填写: null, 原文: "001", 子项: [0, false] };
    fireEvent.change(raw("业务对象（选填）"), { target: { value: JSON.stringify(details) } });
    fireEvent.click(editor("业务对象").getByRole("button", { name: "编辑业务对象第 1 条的已核对" }));
    fireEvent.change(editor("业务对象").getByLabelText("业务对象本次编辑内容"), { target: { value: "false" } });
    fireEvent.click(editor("业务对象").getByRole("button", { name: "应用单元格编辑" }));
    fireEvent.click(editor("业务对象").getByRole("button", { name: "添加业务字段" }));
    fireEvent.change(editor("业务对象").getByLabelText("业务对象新增业务字段名称"), { target: { value: "业务备注" } });
    fireEvent.change(editor("业务对象").getByLabelText("业务对象本次编辑内容"), { target: { value: "  保留多行\n和原文  " } });
    fireEvent.click(editor("业务对象").getByRole("button", { name: "添加字段到原输入" }));
    expect(JSON.parse(raw("业务对象（选填）").value)).toEqual({ ...details, 业务备注: "  保留多行\n和原文  " });
    expect(raw()).toHaveValue("[0,false]");
    expect(start).not.toHaveBeenCalled();
  });

  it("网页确认清空同时作废pending文件读取，迟到文本不能填回已清空表单", async () => {
    let finish!: (text: string) => void;
    const file = new File(["旧资料"], "业务.csv");
    Object.defineProperty(file, "text", { value: () => new Promise<string>((resolve) => { finish = resolve; }) });
    render(view("web")); fillOriginal();
    fireEvent.click(editor().getByRole("button", { name: "从表格或本地文件导入" }));
    fireEvent.change(editor().getByLabelText("导入业务清单本地文件"), { target: { files: [file] } });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "清空试填" }));
    await user.click(within(screen.getByRole("dialog", { name: "清空当前试填内容？" })).getByRole("button", { name: "确认清空试填" }));
    await act(async () => finish(csv));
    expect(raw()).toHaveValue(""); expect(raw("业务正文（必填）")).toHaveValue("");
    expect(screen.queryByText(/项本地填写尚未应用/)).not.toBeInTheDocument();
    expect(start).not.toHaveBeenCalled(); expect(push).not.toHaveBeenCalled();
  });
});
