import Link from "next/link";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import HarnessPage from "@/app/(console)/harness/page";
import { WorkspacePolicyPanel } from "@/features/harness/WorkspacePolicyPanel";
import { DraftNavigationGuard } from "@/features/workflow-canvas/DraftNavigationGuard";
import { harnessDraftRequest } from "@/features/harness/harness-policy-draft";
import { HarnessPolicyReadResult, HarnessPolicySaveInput, type HarnessPolicySaveResult } from "@/contracts/harness-management";
import { HarnessSimulationInput, type HarnessSimulationResult } from "@/contracts/harness-simulation";

const mocks = vi.hoisted(() => ({ save: vi.fn(), simulate: vi.fn(), read: vi.fn(), refresh: vi.fn(), runs: vi.fn(), resources: vi.fn(), history: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/server/actions/save-harness-policy", () => ({ saveHarnessPolicyAction: mocks.save }));
vi.mock("@/server/actions/simulate-harness-policy", () => ({ simulateHarnessPolicyAction: mocks.simulate }));
vi.mock("@/server/queries/harness-policies", () => ({ getHarnessPolicyQuery: mocks.read }));
vi.mock("@/server/queries/runs", () => ({ listRuns: mocks.runs }));
vi.mock("@/server/queries/execution-resources", () => ({ getExecutionResourcePolicy: mocks.resources, listExecutionPolicyHistory: mocks.history }));
vi.mock("@/server/security/query-error", () => ({ withSafeQueryError: (query: () => Promise<unknown>) => query() }));

const requestId = "00000000-0000-4000-8000-000000000081";
const emptyRead = HarnessPolicyReadResult.parse({ ok: true, policy: { revision: 0, source: "unconfigured", policy: null, updatedAt: null } });
function configured(revision = 1, effect: "allow" | "deny" = "deny") {
  return HarnessPolicyReadResult.parse({ ok: true, policy: { revision, source: "configured", updatedAt: "2026-10-12T02:00:00.000Z",
    policy: { version: 1, rules: [{ id: "private-rule-reference", effect, when: { nodeType: "tool" }, reason: "限制外部变更" }] } } });
}
function pending<T>() { let resolve!: (result: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
async function fillNew() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "添加安全规则" }));
  await user.type(screen.getByRole("textbox", { name: "安全规则修改原因" }), "隔离环境核对外部变更边界");
  await user.click(screen.getByRole("button", { name: "核对并保存安全规则" }));
  return user;
}

describe("真实工作区安全规则表单与父页面", () => {
  beforeEach(() => {
    vi.restoreAllMocks(); vi.clearAllMocks();
    mocks.read.mockResolvedValue(emptyRead); mocks.runs.mockResolvedValue([]);
    mocks.resources.mockResolvedValue({ policy: { revision: 0, source: "default", limits: { maxConcurrentChains: 50, maxModelCalls: 200, maxChildRuns: 100 }, updatedAt: null }, capacity: { reservedChains: 0, untrackedActiveRuns: 0, availableSlots: 50 }, assessedAt: "2026-10-12T02:00:00.000Z" });
    mocks.history.mockResolvedValue({ ok: true, items: [], nextBeforeRevision: null });
    mocks.simulate.mockReset().mockResolvedValue({ ok: true, mode: "draft", coverage: "deterministic-rules-only", decisions: [{ subjectIndex: 0, allowed: false, invalid: false, source: "workspace", matchedRuleIndex: 0 }] });
    mocks.save.mockImplementation(async (raw: HarnessPolicySaveInput) => ({ ok: true, recordedRevision: raw.expectedRevision + 1,
      policy: { revision: raw.expectedRevision + 1, source: raw.policy === null ? "cleared" : "configured", policy: raw.policy, updatedAt: "2026-10-12T02:00:00.000Z" } }));
  });

  it("父页面真实读规则，局部失败不伪造无规则、不阻断资源与诊断", async () => {
    mocks.read.mockRejectedValueOnce(new Error("private-db-credential"));
    const user = userEvent.setup();
    render(await HarnessPage({ searchParams: Promise.resolve({}) }));
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith();
    await user.click(screen.getByRole("tab", { name: "安全规则" }));
    expect(screen.getByRole("heading", { name: "工作区安全规则" })).toBeInTheDocument();
    expect(screen.getByText(/安全规则暂时无法读取，当前配置未知/)).toBeInTheDocument();
    expect(screen.queryByText("尚未设置工作区附加规则")).not.toBeInTheDocument();
    expect(screen.queryByText(/private-db-credential/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "资源限额" }));
    expect(screen.getByText("服务端默认设置")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "运行诊断" }));
    expect(screen.getByRole("heading", { name: "选择一次运行查看诊断" })).toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("空可选字段真正省略，不把 undefined 传给普通 JSON 契约", () => {
    const parsed = harnessDraftRequest({ version: 1, rules: [{ id: "rule", effect: "deny", when: { nodeType: undefined, scope: "" }, reason: " " }] }, "明确原因", 0, requestId);
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error("合法表单未生成请求");
    expect(parsed.data.policy).toEqual({ version: 1, rules: [{ id: "rule", effect: "deny", when: {} }] });
    expect(HarnessPolicySaveInput.safeParse(parsed.data).success).toBe(true);
  });

  it("只在明确确认后写一次，新增规则、原因与原版本走共享契约", async () => {
    const deferred = pending<HarnessPolicySaveResult>(); mocks.save.mockReturnValueOnce(deferred.promise);
    render(<WorkspacePolicyPanel initialRead={emptyRead} />);
    const user = await fillNew();
    expect(mocks.save).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "确认保存安全规则" });
    await user.dblClick(within(dialog).getByRole("button", { name: "确认提交这次修改" }));
    expect(mocks.save).toHaveBeenCalledTimes(1);
    const sent = HarnessPolicySaveInput.parse(mocks.save.mock.calls[0][0]);
    expect(sent).toMatchObject({ expectedRevision: 0, confirmed: true, reason: "隔离环境核对外部变更边界", policy: { version: 1, rules: [{ effect: "deny", when: { nodeType: "tool" } }] } });
    await act(async () => deferred.resolve({ ok: true, recordedRevision: 1, policy: { revision: 1, source: "configured", policy: sent.policy, updatedAt: "2026-10-12T02:00:00.000Z" } }));
    expect(screen.getByText(/这次请求已保存为第 1 版/)).toBeInTheDocument();
    expect(screen.queryByText(/用原请求再次确认保存/)).not.toBeInTheDocument();
  });

  it("未知结果沿完整原请求二次确认，不因重读相同规则自动认定成功", async () => {
    mocks.save.mockRejectedValueOnce(new Error("private-network-failure"));
    const view = render(<WorkspacePolicyPanel initialRead={emptyRead} />);
    const user = await fillNew(); await user.click(screen.getByRole("button", { name: "确认提交这次修改" }));
    await screen.findByText(/保存结果尚未确认/);
    const sent = HarnessPolicySaveInput.parse(mocks.save.mock.calls[0][0]);
    view.rerender(<WorkspacePolicyPanel initialRead={{ ok: true, policy: { revision: 1, source: "configured", policy: sent.policy, updatedAt: "2026-10-12T02:00:00.000Z" } }} />);
    expect(screen.getByText(/不能凭当前规则相同就认定原请求成功/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "安全规则修改原因" })).toBeDisabled();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "用原请求再次确认保存" }));
    expect(screen.getByText(/这是写入重试，不是只读查询/)).toBeInTheDocument();
    expect(mocks.save).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "确认重试原请求" }));
    await screen.findByText(/这次请求已保存为第 1 版/);
    expect(mocks.save.mock.calls[1][0]).toEqual(sent);
    expect(screen.queryByText(/private-network-failure/)).not.toBeInTheDocument();
  });

  it("新读取取消旧确认且保留填写，不自动换版本提交", async () => {
    const view = render(<WorkspacePolicyPanel initialRead={emptyRead} />);
    await fillNew();
    view.rerender(<WorkspacePolicyPanel initialRead={configured(2)} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "安全规则修改原因" })).toHaveValue("隔离环境核对外部变更边界");
    expect(screen.getByRole("button", { name: "核对并保存安全规则" })).toBeDisabled();
    expect(screen.getByText(/不能自动覆盖/)).toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await userEvent.setup().click(screen.getByRole("button", { name: "按最新规则开始新修改" }));
    expect(screen.getByRole("textbox", { name: "安全规则修改原因" })).toHaveValue("隔离环境核对外部变更边界");
  });

  it("幂等旧写入回执与较新当前规则分开，不把原内容说成重新启用", async () => {
    const latest = configured(4, "allow"); if (!latest.ok) throw new Error("夹具无效");
    mocks.save.mockResolvedValueOnce({ ok: true, recordedRevision: 2, policy: latest.policy });
    render(<WorkspacePolicyPanel initialRead={configured(1)} />);
    const user = userEvent.setup(); await user.type(screen.getByRole("textbox", { name: "安全规则修改原因" }), "明确保存原规则");
    await user.click(screen.getByRole("button", { name: "核对并保存安全规则" })); await user.click(screen.getByRole("button", { name: "确认提交这次修改" }));
    await screen.findByText(/这次请求已保存为第 2 版/);
    expect(screen.getByText(/回执同时返回第 4 版/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "处理方式" })).toHaveValue("deny");
    expect(screen.getByText(/有未保存填写/)).toBeInTheDocument();
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it("清除是明确提交 null，不是允许所有动作或保存空数组", async () => {
    render(<WorkspacePolicyPanel initialRead={configured()} />);
    const user = userEvent.setup(); await user.type(screen.getByRole("textbox", { name: "安全规则修改原因" }), "移除工作区附加限制");
    await user.click(screen.getByRole("button", { name: "清除工作区规则" }));
    expect(screen.getByText(/不会解除管理员规则、工具权限或已冻结任务的限制/)).toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认提交这次修改" }));
    await screen.findByText(/工作区附加规则已清除/);
    expect(mocks.save.mock.calls[0][0]).toMatchObject({ expectedRevision: 1, policy: null });
  });

  it("缺规则读取后只能明确从最新版本开始；未保存填写接真实离页保护", async () => {
    const view = render(<><DraftNavigationGuard /><WorkspacePolicyPanel initialRead={{ ok: false, error: "读取失败" }} /><Link href="/agents" prefetch={false}>返回助手</Link></>);
    expect(screen.getByRole("button", { name: "添加安全规则" })).toBeDisabled();
    view.rerender(<><DraftNavigationGuard /><WorkspacePolicyPanel initialRead={emptyRead} /><Link href="/agents" prefetch={false}>返回助手</Link></>);
    const user = userEvent.setup(); await user.click(screen.getByRole("button", { name: "按最新规则开始新修改" }));
    await user.click(screen.getByRole("button", { name: "添加安全规则" }));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const accepted = fireEvent.click(screen.getByRole("link", { name: "返回助手" }));
    expect(accepted).toBe(false); expect(confirm).toHaveBeenCalledTimes(1); expect(mocks.save).not.toHaveBeenCalled();
  });

  it("离页后的迟到回执不会替换另一个编辑会话", async () => {
    const deferred = pending<HarnessPolicySaveResult>(); mocks.save.mockReturnValueOnce(deferred.promise);
    const old = render(<WorkspacePolicyPanel initialRead={emptyRead} />);
    const user = await fillNew(); await user.click(screen.getByRole("button", { name: "确认提交这次修改" })); old.unmount();
    render(<WorkspacePolicyPanel initialRead={configured(7)} />);
    const sent = HarnessPolicySaveInput.parse(mocks.save.mock.calls[0][0]);
    await act(async () => deferred.resolve({ ok: true, recordedRevision: 1, policy: { revision: 1, source: "configured", policy: sent.policy, updatedAt: "2026-10-12T02:00:00.000Z" } }));
    expect(screen.getByText(/已保存 1 条附加规则 · 第 7 版/)).toBeInTheDocument();
    expect(screen.queryByText(/这次请求已保存为第 1 版/)).not.toBeInTheDocument();
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it("保存等待中读到较新规则，迟到旧回执只确认原请求、不回退读数", async () => {
    const deferred = pending<HarnessPolicySaveResult>(); mocks.save.mockReturnValueOnce(deferred.promise);
    const view = render(<WorkspacePolicyPanel initialRead={emptyRead} />);
    const user = await fillNew(); await user.click(screen.getByRole("button", { name: "确认提交这次修改" }));
    view.rerender(<WorkspacePolicyPanel initialRead={configured(5, "allow")} />);
    const sent = HarnessPolicySaveInput.parse(mocks.save.mock.calls[0][0]);
    await act(async () => deferred.resolve({ ok: true, recordedRevision: 1, policy: { revision: 1, source: "configured", policy: sent.policy, updatedAt: "2026-10-12T02:00:00.000Z" } }));
    expect(screen.getByText(/已保存 1 条附加规则 · 第 5 版/)).toBeInTheDocument();
    expect(screen.getByText(/这次请求已保存为第 1 版/)).toBeInTheDocument();
    expect(screen.getByText(/规则版本发生变化/)).toBeInTheDocument();
  });

  it("读取失败或旧版本不能丢掉高水位，再次更旧读取仍未知且不放开写入", () => {
    const view = render(<WorkspacePolicyPanel initialRead={configured(5)} />);
    view.rerender(<WorkspacePolicyPanel initialRead={configured(3)} />);
    expect(screen.getByText(/安全规则暂时无法读取/)).toBeInTheDocument();
    view.rerender(<WorkspacePolicyPanel initialRead={{ ok: false, error: "读取中断" }} />);
    view.rerender(<WorkspacePolicyPanel initialRead={configured(2)} />);
    expect(screen.getByText(/安全规则暂时无法读取/)).toBeInTheDocument();
    expect(screen.queryByText(/已保存 1 条附加规则 · 第 2 版/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "核对并保存安全规则" })).toBeDisabled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("同写入版本的正文矛盾不能确认成功，完整原请求仍保留", async () => {
    const other = configured(1, "allow"); if (!other.ok) throw new Error("夹具无效");
    mocks.save.mockResolvedValueOnce({ ok: true, recordedRevision: 1, policy: other.policy });
    render(<WorkspacePolicyPanel initialRead={emptyRead} />);
    const user = await fillNew(); await user.click(screen.getByRole("button", { name: "确认提交这次修改" }));
    await screen.findByText(/保存结果尚未确认/);
    expect(screen.queryByText(/这次请求已保存为第 1 版/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "用原请求再次确认保存" })).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "处理方式" })).toHaveValue("deny");
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it("取消确认或按ESC恢复触发焦点，不清填写也不写入", async () => {
    render(<WorkspacePolicyPanel initialRead={emptyRead} />);
    const user = await fillNew(); await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "核对并保存安全规则" })).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "安全规则修改原因" })).toHaveValue("隔离环境核对外部变更边界");
    await user.click(screen.getByRole("button", { name: "清除工作区规则" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "返回" }));
    expect(screen.getByRole("button", { name: "清除工作区规则" })).toHaveFocus();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("显式试算真实动作输入，命中当前草稿不冒保存、执行或历史判决", async () => {
    render(<WorkspacePolicyPanel initialRead={configured()} />);
    const user = userEvent.setup();
    await user.click(screen.getByText("试算技术条件（开发者）"));
    await user.type(screen.getByRole("textbox", { name: "试算 nodeId" }), "explicit-draft-probe");
    await user.click(screen.getByRole("button", { name: "核对草稿命中结果" }));
    await screen.findByText("本组条件被阻止");
    const input = HarnessSimulationInput.parse(mocks.simulate.mock.calls[0][0]);
    expect(input.subjects).toEqual([{ nodeType: "tool", nodeId: "explicit-draft-probe" }]);
    expect(input.policy).toEqual({ version: 1, rules: [{ id: "private-rule-reference", effect: "deny", when: { nodeType: "tool" }, reason: "限制外部变更" }] });
    expect(screen.getByText(/命中当前填写的工作区第 1 条规则/)).toBeInTheDocument();
    expect(screen.getByText(/不说明规则已保存或真实任务已经执行/)).toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });

  it("政策 A→B→A 后不接纳旧试算，原技术条件仍保留", async () => {
    const deferred = pending<HarnessSimulationResult>(); mocks.simulate.mockReturnValueOnce(deferred.promise);
    const view = render(<WorkspacePolicyPanel initialRead={configured()} />);
    const user = userEvent.setup(); await user.click(screen.getByText("试算技术条件（开发者）"));
    await user.type(screen.getByRole("textbox", { name: "试算 nodeId" }), "preserved-probe");
    await user.click(screen.getByRole("button", { name: "核对草稿命中结果" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "处理方式" }), "allow");
    await user.selectOptions(screen.getByRole("combobox", { name: "处理方式" }), "deny");
    await act(async () => deferred.resolve({ ok: true, mode: "draft", coverage: "deterministic-rules-only", decisions: [{ subjectIndex: 0, allowed: false, invalid: false, source: "workspace", matchedRuleIndex: 0 }] }));
    expect(screen.queryByText("本组条件被阻止")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "试算 nodeId" })).toHaveValue("preserved-probe");
    expect(screen.getByText(/原试算结果已清除/)).toBeInTheDocument();
    view.unmount(); expect(mocks.save).not.toHaveBeenCalled();
  });

  it("停止显示后明确另发只读试算，迟到旧判决不替换新判决", async () => {
    const first = pending<HarnessSimulationResult>(); const second = pending<HarnessSimulationResult>();
    mocks.simulate.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<WorkspacePolicyPanel initialRead={configured()} />);
    const user = userEvent.setup(); await user.click(screen.getByText("试算技术条件（开发者）"));
    await user.type(screen.getByRole("textbox", { name: "试算 nodeId" }), "explicit-probe");
    await user.click(screen.getByRole("button", { name: "核对草稿命中结果" }));
    await user.click(screen.getByRole("button", { name: "停止显示本次试算" }));
    expect(screen.getByText(/不会取消服务端已发出的只读计算/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "核对草稿命中结果" }));
    await act(async () => second.resolve({ ok: true, mode: "draft", coverage: "deterministic-rules-only", decisions: [{ subjectIndex: 0, allowed: false, invalid: false, source: "administrator", matchedRuleIndex: null }] }));
    expect(screen.getByText(/管理员规则限制/)).toBeInTheDocument();
    await act(async () => first.resolve({ ok: true, mode: "draft", coverage: "deterministic-rules-only", decisions: [{ subjectIndex: 0, allowed: true, invalid: false, source: "workspace", matchedRuleIndex: null }] }));
    expect(screen.queryByText("本组条件允许继续")).not.toBeInTheDocument();
    expect(screen.getByText(/管理员规则限制/)).toBeInTheDocument();
    expect(mocks.simulate).toHaveBeenCalledTimes(2); expect(mocks.save).not.toHaveBeenCalled();
  });

  it("缺条件或越界判决保持未知，不把错误显示成无命中允许", async () => {
    mocks.simulate.mockResolvedValueOnce({ ok: true, mode: "draft", coverage: "deterministic-rules-only", decisions: [{ subjectIndex: 0, allowed: true, invalid: false, source: "workspace", matchedRuleIndex: 1 }] });
    render(<WorkspacePolicyPanel initialRead={configured()} />);
    const user = userEvent.setup(); await user.click(screen.getByRole("button", { name: "核对草稿命中结果" }));
    expect(mocks.simulate).not.toHaveBeenCalled();
    await user.click(screen.getByText("试算技术条件（开发者）"));
    await user.type(screen.getByRole("textbox", { name: "试算 nodeId" }), "explicit-probe");
    await user.click(screen.getByRole("button", { name: "核对草稿命中结果" }));
    await screen.findByText(/试算结果暂时无法核对/);
    expect(screen.queryByText("本组条件允许继续")).not.toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("真实缺少管理员配置的无效判决不冒充正常命中或未命中", async () => {
    mocks.simulate.mockResolvedValueOnce({ ok: true, mode: "draft", coverage: "deterministic-rules-only", decisions: [{ subjectIndex: 0, allowed: false, invalid: true, source: "administrator", matchedRuleIndex: null }] });
    render(<WorkspacePolicyPanel initialRead={configured()} />);
    const user = userEvent.setup(); await user.click(screen.getByText("试算技术条件（开发者）"));
    await user.type(screen.getByRole("textbox", { name: "试算 nodeId" }), "explicit-probe");
    await user.click(screen.getByRole("button", { name: "核对草稿命中结果" }));
    await screen.findByText("配置无效，试算阻止");
    expect(screen.getByText(/这不是正常的命中或未命中/)).toBeInTheDocument();
    expect(screen.queryByText(/工作区附加规则未命中|管理员规则限制，不能通过/)).not.toBeInTheDocument();
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
