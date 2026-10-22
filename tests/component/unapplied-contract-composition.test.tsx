import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Link from "next/link";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowDraft } from "@/contracts/workflow";
import { FlowCanvas } from "@/features/workflow-canvas/FlowCanvas";
import { NodeInspector } from "@/features/workflow-canvas/NodeInspector";
import { DraftNavigationGuard } from "@/features/workflow-canvas/DraftNavigationGuard";
import { DRAFT_STATE_EVENT, type DraftStateDetail } from "@/lib/draft-state";
import { saveWorkflowAction } from "@/server/actions/save-workflow";
import { contractSchema, nodeContractWorkflow } from "../fixtures/node-contract-workflow";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/server/actions/save-workflow", () => ({ saveWorkflowAction: vi.fn() }));
vi.mock("@xyflow/react", () => ({ ReactFlow: () => <div aria-label="测试画布" />, Background: () => null, Controls: () => null }));
const revision = "2026-10-09T00:00:00.000Z";
beforeEach(() => {
  vi.clearAllMocks(); vi.mocked(saveWorkflowAction).mockReset(); window.sessionStorage.clear();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function canvas(draft = nodeContractWorkflow(), extras = false) {
  const props = { agentId: draft.rootAgent.id, draft, draftUpdatedAt: revision, agentTargets: [], toolOptions: [], knowledgeSources: [] };
  const view = render(<><FlowCanvas {...props} />{extras ? <><DraftNavigationGuard /><Link href="/agents/other">离开测试页</Link></> : null}</>);
  return { ...view, props };
}
async function select(id: string) { await userEvent.selectOptions(screen.getByRole("combobox", { name: "定位流程步骤" }), id); }
async function open(label = "当前步骤") {
  const summary = screen.getByLabelText(label + "输入与结果约定");
  if (!(summary.closest("details") as HTMLDetailsElement).open) await userEvent.click(summary);
  return within(await screen.findByRole("region", { name: label + "字段约定" }));
}
function literal(panel: ReturnType<typeof within>, value = "false") {
  fireEvent.click(panel.getByRole("button", { name: "开始配置输入映射" }));
  fireEvent.click(panel.getByRole("button", { name: "添加字段映射" }));
  const row = within(panel.getByRole("group", { name: "字段映射 1" }));
  fireEvent.change(row.getByRole("textbox", { name: "目标路径第 1 层" }), { target: { value: "金额" } });
  fireEvent.change(row.getByRole("combobox", { name: "字段来源" }), { target: { value: "literal" } });
  fireEvent.change(row.getByRole("textbox", { name: "固定值（数据格式）" }), { target: { value } });
}
async function applyInput(panel: ReturnType<typeof within>) {
  await userEvent.click(panel.getByRole("button", { name: "校验并应用到画布草稿" }));
  await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "明确确认本次修改" }));
}
function model(panel: ReturnType<typeof within>, value = "{") {
  fireEvent.click(panel.getByRole("checkbox", { name: "使用结构化结果" }));
  fireEvent.change(panel.getByLabelText("结果字段规则"), { target: { value } });
}

describe("真实画布的未应用配置保护", () => {
  it("切换与关闭详情后恢复两类填写，不提升或存储试算样例", async () => {
    canvas(); await select("top"); let panel = await open();
    const storage = vi.spyOn(Storage.prototype, "setItem");
    literal(panel); model(panel);
    fireEvent.change(panel.getByRole("textbox", { name: "运行输入样例（数据格式）" }), { target: { value: '{"敏感样例":"仅本试算"}' } });
    await select("group"); await select("top"); panel = await open();
    expect(panel.getByRole("textbox", { name: "固定值（数据格式）" })).toHaveValue("false");
    expect(panel.getByLabelText("结果字段规则")).toHaveValue("{");
    expect(panel.getByRole("textbox", { name: "运行输入样例（数据格式）" })).toHaveValue("");
    await userEvent.click(screen.getAllByRole("button", { name: "关闭节点详情" })[0]);
    await select("top"); panel = await open();
    expect(panel.getByLabelText("结果字段规则")).toHaveValue("{");
    expect(storage).not.toHaveBeenCalled(); expect(saveWorkflowAction).not.toHaveBeenCalled();
    expect(screen.getByLabelText("未应用配置提醒")).toHaveTextContent("2 处");
  });
  it("折叠保留配置，取消真实请求；重新展开不自动提交或恢复样例", async () => {
    const calls: { signal: AbortSignal; resolve: (value: Response) => void }[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: unknown, init: RequestInit) => new Promise<Response>((resolve) => calls.push({ signal: init.signal as AbortSignal, resolve }))));
    canvas(); await select("top"); let panel = await open(); literal(panel);
    fireEvent.change(panel.getByRole("textbox", { name: "运行输入样例（数据格式）" }), { target: { value: "{}" } });
    fireEvent.click(panel.getByRole("button", { name: "提交样例做只读试算" }));
    expect(calls).toHaveLength(1);
    await userEvent.click(screen.getByLabelText("当前步骤输入与结果约定"));
    await waitFor(() => expect(calls[0].signal.aborted).toBe(true));
    panel = await open();
    expect(panel.getByRole("textbox", { name: "固定值（数据格式）" })).toHaveValue("false");
    expect(panel.getByRole("textbox", { name: "运行输入样例（数据格式）" })).toHaveValue("");
    await act(async () => calls[0].resolve(new Response("{}", { headers: { "content-type": "application/json" } })));
    expect(calls).toHaveLength(1); expect(panel.queryByText("参考试算暂时无法读取")).not.toBeInTheDocument();
  });
  it.each(["switch", "close", "unmount"])("请求中 %s 触发真实取消，迟到回复不覆盖配置", async (action) => {
    let signal: AbortSignal | undefined, resolve!: (value: Response) => void;
    vi.stubGlobal("fetch", vi.fn((_url: unknown, init: RequestInit) => { signal = init.signal as AbortSignal; return new Promise<Response>((done) => { resolve = done; }); }));
    const view = canvas(); await select("top"); const panel = await open(); literal(panel);
    fireEvent.change(panel.getByRole("textbox", { name: "运行输入样例（数据格式）" }), { target: { value: "{}" } });
    fireEvent.click(panel.getByRole("button", { name: "提交样例做只读试算" }));
    if (action === "switch") await select("group");
    else if (action === "close") await userEvent.click(screen.getAllByRole("button", { name: "关闭节点详情" })[0]);
    else view.unmount();
    expect(signal!.aborted).toBe(true);
    await act(async () => resolve(new Response("{}", { headers: { "content-type": "application/json" } })));
    expect(saveWorkflowAction).not.toHaveBeenCalled();
  });
  it("同批输入 A→B→A 仍取消旧试算，不自动重新提交", async () => {
    let signal: AbortSignal | undefined;
    const fetch = vi.fn((_url: unknown, init: RequestInit) => { signal = init.signal as AbortSignal; return new Promise<Response>(() => {}); });
    vi.stubGlobal("fetch", fetch);
    canvas(); await select("top"); const panel = await open(); literal(panel);
    fireEvent.change(panel.getByRole("textbox", { name: "运行输入样例（数据格式）" }), { target: { value: "{}" } });
    fireEvent.click(panel.getByRole("button", { name: "提交样例做只读试算" }));
    const value = panel.getByRole("textbox", { name: "固定值（数据格式）" });
    act(() => { fireEvent.change(value, { target: { value: "0" } }); fireEvent.change(value, { target: { value: "false" } }); });
    await waitFor(() => expect(signal!.aborted).toBe(true));
    expect(value).toHaveValue("false"); expect(fetch).toHaveBeenCalledOnce();
  });
  it("应用输入只清本类；另一类保留但需重新核对，撤销重做不复活已应用填写", async () => {
    const started = performance.now();
    let previous = started;
    function phase(name: string) {
      const now = performance.now();
      console.info("[未应用配置路径耗时]", name, { previousPhaseMs: Math.round(now - previous), totalMs: Math.round(now - started) });
      previous = now;
    }
    phase("开始渲染、选择与展开");
    canvas(); await select("top"); let panel = await open(); literal(panel); model(panel);
    phase("开始明确应用输入");
    await applyInput(panel);
    phase("开始核对另类保留和锁定");
    expect(screen.getByLabelText("未应用配置提醒")).toHaveTextContent("1 处");
    expect(panel.getByLabelText("结果字段规则")).toHaveValue("{");
    expect(panel.getByRole("button", { name: "应用到当前草稿" })).toBeDisabled();
    phase("开始撤销");
    await userEvent.click(screen.getByRole("button", { name: "撤销上一步修改" }));
    phase("开始切换步骤与重新展开");
    await select("group"); await select("top"); panel = await open();
    phase("开始核对输入已清、模型仍保留");
    expect(panel.getByRole("button", { name: "开始配置输入映射" })).toBeInTheDocument();
    expect(panel.getByLabelText("结果字段规则")).toHaveValue("{");
    phase("开始重做");
    await userEvent.click(screen.getByRole("button", { name: "重做上一步修改" }));
    phase("开始核对同一固定值");
    expect(panel.getByRole("textbox", { name: "固定值（数据格式）" })).toHaveValue("false");
    phase("开始取消模型填写");
    await userEvent.click(panel.getByRole("button", { name: "取消编辑" }));
    expect(screen.queryByLabelText("未应用配置提醒")).not.toBeInTheDocument();
    phase("原路径全部完成");
  });
  it("画布 A→B→A 后旧输入确认失效，原填写保留", async () => {
    canvas(); await select("top"); const panel = await open(); literal(panel);
    fireEvent.change(screen.getByLabelText("节点名称"), { target: { value: "新名称" } });
    const undo = screen.getByRole("button", { name: "撤销上一步修改" });
    await userEvent.click(panel.getByRole("button", { name: "重新读取当前草稿" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(undo);
    fireEvent.click(within(dialog).getByRole("button", { name: "明确确认本次修改" }));
    expect(panel.getByRole("textbox", { name: "固定值（数据格式）" })).toHaveValue("false");
    expect(panel.getByRole("button", { name: "校验并应用到画布草稿" })).toBeDisabled();
    expect(panel.getByText(/原确认失效/)).toBeInTheDocument();
  });
  it("完整父回调拒绝或无回执，不清除模型填写或显示成功", async () => {
    const draft = nodeContractWorkflow(), change = vi.fn();
    render(<NodeInspector node={draft.nodes.top} workflow={draft} onNodeChange={change} onNodeDelete={vi.fn()} />);
    const panel = await open(); model(panel, JSON.stringify(contractSchema));
    await userEvent.click(panel.getByRole("button", { name: "应用到当前草稿" }));
    expect(change).toHaveBeenCalledOnce();
    expect(panel.getByLabelText("结果字段规则")).toHaveValue(JSON.stringify(contractSchema));
    expect(panel.getByText(/完整画布草稿未接受/)).toBeInTheDocument();
    expect(panel.queryByText("结果约定已应用到当前草稿，尚未保存或发布。")).not.toBeInTheDocument();
  });
  it("有效相同值由真实父层接受，不增加撤销记录或待保存修改", async () => {
    const draft = nodeContractWorkflow();
    draft.nodes.top.inputMapping = { fields: [{ target: ["金额"], source: { kind: "literal", value: false }, required: true }], includeUpstreamOutputs: false };
    canvas(draft); await select("top"); const panel = await open(); await applyInput(panel);
    expect(panel.getByText(/已交给画布草稿/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "撤销上一步修改" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    expect(screen.queryByLabelText("未应用配置提醒")).not.toBeInTheDocument();
  });
  it("输入填写 A→B→A 也不能复用已打开的应用确认", async () => {
    canvas(); await select("top"); const panel = await open(); literal(panel);
    const value = panel.getByRole("textbox", { name: "固定值（数据格式）" });
    fireEvent.click(panel.getByRole("button", { name: "校验并应用到画布草稿" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(value, { target: { value: "0" } });
    fireEvent.change(value, { target: { value: "false" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "明确确认本次修改" }));
    expect(value).toHaveValue("false"); expect(panel.getByText(/原确认失效/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    expect(screen.getByLabelText("未应用配置提醒")).toHaveTextContent("1 处");
  });
  it.each(["false", "throw"])("父回调 %s 时保留填写，拒绝替换成功提示", async (mode) => {
    const draft = nodeContractWorkflow(), change = vi.fn(() => { if (mode === "throw") throw new Error("rejected"); return false; });
    render(<NodeInspector node={draft.nodes.group} workflow={draft} onNodeChange={change} onNodeDelete={vi.fn()} />);
    const panel = await open("步骤组步骤 1"); model(panel, JSON.stringify(contractSchema));
    await userEvent.click(panel.getByRole("button", { name: "应用到当前草稿" }));
    expect(change).toHaveBeenCalledOnce();
    expect(panel.getByLabelText("结果字段规则")).toHaveValue(JSON.stringify(contractSchema));
    expect(panel.getByText(/完整画布草稿未接受/)).toBeInTheDocument();
  });
  it("模型替换确认跨撤销重做回同值后仍失效", async () => {
    const draft = nodeContractWorkflow(); draft.nodes.top.modelOutput = { format: "json", schema: contractSchema, providerMode: "json", maxRepairAttempts: 0 };
    canvas(draft); await select("top"); const panel = await open();
    fireEvent.change(screen.getByLabelText("节点名称"), { target: { value: "新名称" } });
    const undo = screen.getByRole("button", { name: "撤销上一步修改" }), redo = screen.getByRole("button", { name: "重做上一步修改" });
    fireEvent.click(panel.getByRole("button", { name: "编辑结果约定" }));
    const schema = JSON.stringify({ type: "object", properties: { 新字段: { type: "number" } } });
    fireEvent.change(panel.getByLabelText("结果字段规则"), { target: { value: schema } });
    fireEvent.click(panel.getByRole("button", { name: "应用到当前草稿" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(undo); fireEvent.click(redo);
    fireEvent.click(within(dialog).getByRole("button", { name: "确认替换约定" }));
    expect(panel.getByLabelText("结果字段规则")).toHaveValue(schema);
    expect(panel.getByText(/原确认失效/)).toBeInTheDocument();
    expect(panel.queryByText("结果约定已应用到当前草稿，尚未保存或发布。")).not.toBeInTheDocument();
  });
  it("两个并行分支使用同一步骤标识，重新选择后分别恢复", async () => {
    canvas(); await select("parallel");
    const left = await open("并行工作 1 步骤 1"); literal(left, "0");
    const right = await open("并行工作 2 步骤 1"); literal(right, "false");
    await select("top"); await select("parallel");
    expect((await open("并行工作 1 步骤 1")).getByRole("textbox", { name: "固定值（数据格式）" })).toHaveValue("0");
    expect((await open("并行工作 2 步骤 1")).getByRole("textbox", { name: "固定值（数据格式）" })).toHaveValue("false");
  });
  it("仅有未应用配置也通知脏状态并保护原同站链接和 beforeunload", async () => {
    const states: DraftStateDetail[] = [], receive = (event: Event) => states.push((event as CustomEvent<DraftStateDetail>).detail);
    window.addEventListener(DRAFT_STATE_EVENT, receive);
    try {
      canvas(undefined, true); await select("top"); literal(await open());
      expect(states.at(-1)?.dirty).toBe(true);
      const leave = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(leave);
      expect(leave.defaultPrevented).toBe(true);
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
      expect(fireEvent.click(screen.getByRole("link", { name: "离开测试页" }))).toBe(false);
      expect(confirm).toHaveBeenCalledOnce();
      await userEvent.click(screen.getByRole("button", { name: "放弃修改" }));
      await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "放弃修改" }));
      expect(states.at(-1)?.dirty).toBe(false);
      const clean = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(clean); expect(clean.defaultPrevented).toBe(false);
    } finally { window.removeEventListener(DRAFT_STATE_EVENT, receive); }
  });
  it("保存回执不清保存期间的新填写，较新的服务端草稿也不覆盖填写", async () => {
    let resolve!: (value: { ok: true; updatedAt: string }) => void;
    vi.mocked(saveWorkflowAction).mockImplementation(() => new Promise((done) => { resolve = done; }));
    const view = canvas(); await select("top"); const panel = await open(); literal(panel); await applyInput(panel);
    await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    fireEvent.change(panel.getByRole("textbox", { name: "固定值（数据格式）" }), { target: { value: "7" } });
    await act(async () => resolve({ ok: true, updatedAt: "2026-10-09T00:00:01.000Z" }));
    const submitted = vi.mocked(saveWorkflowAction).mock.calls[0][1] as WorkflowDraft;
    view.rerender(<FlowCanvas {...view.props} draft={submitted} draftUpdatedAt="2026-10-09T00:00:02.000Z" />);
    expect(panel.getByRole("textbox", { name: "固定值（数据格式）" })).toHaveValue("7");
    expect(screen.getByLabelText("未应用配置提醒")).toHaveTextContent("1 处");
    expect(screen.getByRole("button", { name: "保存草稿" })).toBeDisabled();
    expect(submitted.nodes.top.inputMapping!.fields[0].source).toEqual({ kind: "literal", value: false });
  });
});
