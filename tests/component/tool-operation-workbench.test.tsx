import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createHash, webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolOperationListInput, ToolOperationResolution, ToolOperationResolveInput, ToolOperationSummary, ToolOperationView, type ToolOperationGetResult, type ToolOperationResolveResult } from "@/contracts/tool-operation";
import { canonicalJson } from "@/server/domain/canonical-json";
import { readToolOperation, readToolOperations, submitToolOperationResolution } from "@/features/tool-operations/tool-operation-client";
import { ToolOperationReconciliationForm } from "@/features/tool-operations/ToolOperationReconciliationForm";
import { ToolOperationDetails } from "@/features/tool-operations/ToolOperationDetails";
import { ToolOperationWorkbench } from "@/features/tool-operations/ToolOperationWorkbench";

vi.mock("@/features/tool-operations/tool-operation-client", () => ({ readToolOperation: vi.fn(), readToolOperations: vi.fn(), submitToolOperationResolution: vi.fn() }));
const id = "11111111-1111-4111-8111-111111111111";
const secondId = "44444444-4444-4444-8444-444444444444";
const runId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const operation = ToolOperationView.parse({ id, sourceRunId: runId, nodeTitle: "登记工单", toolId: "private-tool", status: "blocked", error: "业务结果未知", receipt: null, resolutions: [], retryDeadline: "2099-01-01T00:00:00.000Z", createdAt: "2026-10-09T00:00:00.123Z", updatedAt: "2026-10-09T00:00:00.123Z" });
const other = { ...operation, id: secondId, nodeTitle: "登记订单" };
const summary = ToolOperationSummary.parse({ ...operation, resolutionCount: 0 });
const read = vi.mocked(readToolOperation);
const list = vi.mocked(readToolOperations);
const submit = vi.mocked(submitToolOperationResolution);
const uncertain = { ok: false, error: "保存结果暂时无法确认", retryable: true } as const;
const record = (kind: "retry" | "record-receipt" = "record-receipt") => {
  const payload = ToolOperationResolveInput.parse(kind === "retry"
    ? { operationId: id, requestId, kind, reason: "已核对实际业务记录", confirmedNotExecuted: true }
    : { operationId: id, requestId, kind, reason: "已核对实际业务记录", confirmedCompleted: true, receipt: { 数量: 0, 成功: false, 备注: "", 其他: null } });
  return ToolOperationResolution.parse({ requestId, kind, createdBy: runId, createdAt: operation.updatedAt, reason: payload.reason, requestHash: createHash("sha256").update(canonicalJson(payload)).digest("hex") });
};
beforeEach(() => {
  vi.resetAllMocks(); vi.stubGlobal("isSecureContext", true); vi.stubGlobal("crypto", webcrypto); vi.spyOn(crypto, "randomUUID").mockReturnValue(requestId);
  read.mockResolvedValue({ ok: true, operation });
  list.mockResolvedValue({ ok: true, items: [summary], nextCursor: null });
  submit.mockResolvedValue({ ok: true });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function renderForm(current = operation) {
  const lock = vi.fn(); const observed = vi.fn();
  return { ...render(<ToolOperationReconciliationForm operation={current} onLockChange={lock} onObserved={observed} />), lock, observed };
}
async function prepareReceipt(user: ReturnType<typeof userEvent.setup>) {
  fireEvent.change(screen.getByLabelText("核对依据"), { target: { value: "已核对实际业务记录" } });
  fireEvent.change(screen.getByLabelText("实际业务回执", { exact: false }), { target: { value: '{"数量":0,"成功":false,"备注":"","其他":null}' } });
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "检查并保存核对结论" }));
}
async function saveReceipt(user: ReturnType<typeof userEvent.setup>) {
  await prepareReceipt(user); await user.click(screen.getByRole("button", { name: "确认保存核对结论" }));
}

describe("人工核对提交与不确定结果", () => {
  it("未明确确认不能提交；取消最终确认不发请求并返回原焦点", async () => {
    const user = userEvent.setup(); renderForm();
    const button = screen.getByRole("button", { name: "检查并保存核对结论" }); expect(button).toBeDisabled();
    await prepareReceipt(user); expect(submit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "返回" }));
    expect(submit).not.toHaveBeenCalled(); await waitFor(() => expect(button).toHaveFocus());
  });
  it("最终确认后发送唯一契约，实际回执不丢失零与假，不恢复任务", async () => {
    const user = userEvent.setup(); renderForm(); await saveReceipt(user);
    expect(submit).toHaveBeenCalledOnce(); expect(submit.mock.calls[0][0]).toEqual({ operationId: id, requestId, kind: "record-receipt", reason: "已核对实际业务记录", confirmedCompleted: true, receipt: { 数量: 0, 成功: false, 备注: "", 其他: null } });
    expect(screen.getByRole("status")).toHaveTextContent("旧任务未恢复，也未创建新运行"); expect(read).not.toHaveBeenCalled();
  });
  it("发送中重复确认不会多写，禁止核对读取和编辑", async () => {
    let finish!: (result: ToolOperationResolveResult) => void;
    submit.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const user = userEvent.setup(); const { lock } = renderForm(); await prepareReceipt(user);
    await user.dblClick(screen.getByRole("button", { name: "确认保存核对结论" }));
    expect(submit).toHaveBeenCalledOnce(); expect(screen.getByRole("button", { name: "核对最新记录" })).toBeDisabled();
    expect(screen.queryByLabelText("核对依据")).not.toBeInTheDocument(); expect(lock).toHaveBeenLastCalledWith(true);
    await act(async () => finish({ ok: true })); expect(lock).toHaveBeenLastCalledWith(false);
  });
  it("不确定结果不自动读取或重发；先读后显式重发保持原请求和整个回执", async () => {
    submit.mockResolvedValueOnce(uncertain).mockResolvedValueOnce({ ok: true });
    const user = userEvent.setup(); const { lock } = renderForm(); await saveReceipt(user);
    const original = submit.mock.calls[0][0];
    expect(read).not.toHaveBeenCalled(); expect(submit).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "重发同一次核对请求" })).toBeDisabled(); expect(lock).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole("button", { name: "核对最新记录" }));
    expect(read).toHaveBeenCalledWith(id, expect.any(AbortSignal)); expect(submit).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "重发同一次核对请求" })); expect(submit).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "确认重发原核对请求" }));
    expect(submit).toHaveBeenCalledTimes(2); expect(submit.mock.calls[1][0]).toEqual(original);
    expect(crypto.randomUUID).toHaveBeenCalledOnce(); expect(lock).toHaveBeenLastCalledWith(false);
  });
  it("读取历史发现本次记录就确认已保存，不再重发", async () => {
    submit.mockResolvedValue(uncertain); read.mockResolvedValue({ ok: true, operation: { ...operation, status: "completed", receipt: { 数量: 0 }, resolutions: [record()] } });
    const user = userEvent.setup(); const { observed } = renderForm(); await saveReceipt(user);
    await user.click(screen.getByRole("button", { name: "核对最新记录" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("已在最新历史中找到本次核对记录"));
    expect(submit).toHaveBeenCalledOnce(); expect(observed).toHaveBeenCalledOnce(); expect(screen.queryByRole("button", { name: "重发同一次核对请求" })).not.toBeInTheDocument();
  });
  it("读取失败禁止重发，保留固定请求；下一次成功读取后才允许原请求确认", async () => {
    submit.mockResolvedValue(uncertain); read.mockRejectedValueOnce(new Error("暂时断线")).mockResolvedValueOnce({ ok: true, operation });
    const user = userEvent.setup(); renderForm(); await saveReceipt(user);
    await user.click(screen.getByRole("button", { name: "核对最新记录" }));
    expect(screen.getByRole("button", { name: "重发同一次核对请求" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("原请求仍保留");
    await user.click(screen.getByRole("button", { name: "核对最新记录" }));
    expect(screen.getByRole("button", { name: "重发同一次核对请求" })).toBeEnabled(); expect(crypto.randomUUID).toHaveBeenCalledOnce(); expect(submit).toHaveBeenCalledOnce();
  });
  it("另一份结论已完成或历史种类冲突时不能重发，也不误认本次已保存", async () => {
    submit.mockResolvedValue(uncertain); read.mockResolvedValue({ ok: true, operation: { ...operation, status: "completed", resolutions: [record("retry")] } });
    const user = userEvent.setup(); renderForm(); await saveReceipt(user); await user.click(screen.getByRole("button", { name: "核对最新记录" }));
    expect(screen.getByRole("alert")).toHaveTextContent("仍不能确认本次提交"); expect(screen.getByRole("button", { name: "重发同一次核对请求" })).toBeDisabled(); expect(submit).toHaveBeenCalledOnce();
  });
  it("确认弹窗期间记录发生变更，拒绝保存旧快照", async () => {
    const user = userEvent.setup(); const { rerender, lock, observed } = renderForm(); await prepareReceipt(user);
    rerender(<ToolOperationReconciliationForm operation={{ ...operation, updatedAt: "2026-10-09T01:00:00.000Z" }} onLockChange={lock} onObserved={observed} />);
    await user.click(screen.getByRole("button", { name: "确认保存核对结论" }));
    expect(submit).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toHaveTextContent("发生变化"); expect(lock).toHaveBeenLastCalledWith(false);
  });
  it("确定拒绝后只能显式返回修改，之前不会自动生成新请求", async () => {
    submit.mockResolvedValue({ ok: false, error: "业务工具配置已变化，请先核对工具配置" });
    const user = userEvent.setup(); renderForm(); await saveReceipt(user);
    expect(screen.getByRole("alert")).toHaveTextContent("业务工具配置已变化"); expect(crypto.randomUUID).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "返回修改核对内容" }));
    expect(screen.getByLabelText("核对依据")).toHaveValue("已核对实际业务记录"); expect(screen.getByRole("checkbox")).not.toBeChecked(); expect(submit).toHaveBeenCalledOnce();
  });
  it("确认未执行保存允许之后尝试，不立即调用业务工具", async () => {
    const user = userEvent.setup(); renderForm();
    await user.selectOptions(screen.getByLabelText("业务系统查询结果"), "retry");
    fireEvent.change(screen.getByLabelText("核对依据"), { target: { value: "业务系统已确认无此记录" } });
    await user.click(screen.getByRole("checkbox")); await user.click(screen.getByRole("button", { name: "检查并保存核对结论" })); await user.click(screen.getByRole("button", { name: "确认保存核对结论" }));
    expect(submit.mock.calls[0][0]).toEqual({ operationId: id, requestId, kind: "retry", confirmedNotExecuted: true, reason: "业务系统已确认无此记录" });
    expect(screen.getByRole("status")).toHaveTextContent("旧任务未恢复"); expect(read).not.toHaveBeenCalled();
  });
  it("已完成只读；过期记录禁用重新尝试选项", () => {
    const { unmount } = renderForm({ ...operation, status: "completed" }); expect(screen.queryByRole("checkbox")).not.toBeInTheDocument(); unmount();
    renderForm({ ...operation, retryDeadline: "2000-01-01T00:00:00.000Z" }); expect(screen.getByRole("option", { name: "确定未执行，允许之后重新尝试" })).toBeDisabled(); expect(submit).not.toHaveBeenCalled();
  });
  it("卸载后返回的写响应不会回调父组件或触发新的请求", async () => {
    let finish!: (result: ToolOperationResolveResult) => void; submit.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const user = userEvent.setup(); const { unmount, lock, observed } = renderForm(); await saveReceipt(user); const calls = lock.mock.calls.length;
    unmount(); await act(async () => finish({ ok: true })); expect(lock).toHaveBeenCalledTimes(calls); expect(observed).not.toHaveBeenCalled(); expect(submit).toHaveBeenCalledOnce(); expect(read).not.toHaveBeenCalled();
  });
});

describe("真实列表、分页、详情和历史", () => {
  it("配对游标保留微秒，上一批恢复原筛选，不能用客户端切片假分页", async () => {
    const cursor = { id, createdAt: "2026-10-09T00:00:00.123456Z" };
    list.mockResolvedValueOnce({ ok: true, items: [summary], nextCursor: cursor }).mockResolvedValueOnce({ ok: true, items: [], nextCursor: null }).mockResolvedValueOnce({ ok: true, items: [summary], nextCursor: cursor });
    const initialFilters = ToolOperationListInput.parse({ sourceRunId: runId, status: "blocked", limit: 1 });
    const user = userEvent.setup(); render(<ToolOperationWorkbench initialFilters={initialFilters} />);
    await screen.findByRole("button", { name: "下一批记录" }); await user.click(screen.getByRole("button", { name: "下一批记录" }));
    await screen.findByText("当前分页与筛选下没有记录"); expect(list.mock.calls[1][0]).toEqual({ ...initialFilters, before: cursor.createdAt, beforeId: id });
    await user.click(screen.getByRole("button", { name: "上一批记录" })); await screen.findByRole("button", { name: "查看登记工单的核对记录" }); expect(list.mock.calls[2][0]).toEqual(initialFilters); expect(submit).not.toHaveBeenCalled();
  });
  it("改变状态重新请求后端，空态不冒充读取失败", async () => {
    const user = userEvent.setup(); render(<ToolOperationWorkbench initialFilters={{ limit: 20 }} />); await screen.findByRole("button", { name: "查看登记工单的核对记录" });
    list.mockResolvedValueOnce({ ok: false, error: "业务核对记录暂时无法读取" }); await user.selectOptions(screen.getByLabelText("记录状态"), "completed");
    await screen.findByRole("alert"); expect(list.mock.calls[1][0]).toMatchObject({ limit: 20, status: "completed" }); expect(screen.queryByText("当前分页与筛选下没有记录")).not.toBeInTheDocument();
    list.mockResolvedValueOnce({ ok: true, items: [], nextCursor: null }); await user.click(screen.getByRole("button", { name: "重新读取列表" })); await screen.findByText("当前分页与筛选下没有记录"); expect(submit).not.toHaveBeenCalled();
  });
  it("旧详情响应不能覆盖后选择的记录", async () => {
    let finish!: (result: ToolOperationGetResult) => void;
    list.mockResolvedValue({ ok: true, items: [summary, ToolOperationSummary.parse({ ...other, resolutionCount: 0 })], nextCursor: null });
    read.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; })).mockResolvedValueOnce({ ok: true, operation: other });
    const user = userEvent.setup(); render(<ToolOperationWorkbench initialFilters={{ limit: 20 }} />); await screen.findByRole("button", { name: "查看登记工单的核对记录" });
    await user.click(screen.getByRole("button", { name: "查看登记工单的核对记录" })); await user.click(screen.getByRole("button", { name: "查看登记订单的核对记录" }));
    await screen.findByRole("heading", { name: "登记订单", level: 2 }); await act(async () => finish({ ok: true, operation }));
    expect(within(screen.getByRole("region", { name: "核对详情" })).getByRole("heading", { level: 2 })).toHaveTextContent("登记订单"); expect(submit).not.toHaveBeenCalled();
  });
  it("工作台未确认提交锁定筛选、列表和翻页，核对历史后解锁", async () => {
    submit.mockResolvedValue(uncertain);
    const user = userEvent.setup(); render(<ToolOperationWorkbench initialFilters={{ limit: 20 }} />); await screen.findByRole("button", { name: "查看登记工单的核对记录" }); await user.click(screen.getByRole("button", { name: "查看登记工单的核对记录" })); await screen.findByRole("checkbox");
    await saveReceipt(user); expect(screen.getByLabelText("记录状态")).toBeDisabled(); expect(screen.getByRole("button", { name: "重新读取列表" })).toBeDisabled(); expect(screen.getByRole("button", { name: "查看登记工单的核对记录" })).toBeDisabled();
    read.mockResolvedValueOnce({ ok: true, operation: { ...operation, resolutions: [record()], status: "completed" } }); await user.click(screen.getByRole("button", { name: "核对最新记录" }));
    expect(screen.getByLabelText("记录状态")).toBeEnabled(); expect(screen.getByRole("region", { name: "核对历史" })).toHaveTextContent("第1次核对"); expect(submit).toHaveBeenCalledOnce();
  });
  it("只读历史保留零值回执、隐藏敏感与内部标识，不发送请求", () => {
    const current = { ...operation, receipt: { 数量: 0, 成功: false, email: "person@example.test", token: "real-private-secret", 来源: id }, resolutions: [{ ...record(), reason: `已查询 ${runId} private-tool person@example.test` }] };
    const { container } = render(<ToolOperationDetails operation={current} />);
    expect(container.textContent).toContain('"数量": 0'); expect(container.textContent).toContain('"成功": false');
    for (const value of [id, runId, requestId, "private-tool", "person@example.test", "real-private-secret", "b".repeat(64)]) expect(container.textContent).not.toContain(value);
    expect(container.textContent).toContain("未提供原始提交参数"); expect(submit).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
  });
});
