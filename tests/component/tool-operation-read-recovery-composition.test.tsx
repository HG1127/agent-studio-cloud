import { createHash, webcrypto } from "node:crypto";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolOperationResolveInput, ToolOperationSummary, ToolOperationView } from "@/contracts/tool-operation";
import { canonicalJson } from "@/server/domain/canonical-json";
import { ToolOperationWorkbench } from "@/features/tool-operations/ToolOperationWorkbench";
import { ToolOperationReconciliationForm } from "@/features/tool-operations/ToolOperationReconciliationForm";

const id = (value: number): ReturnType<typeof crypto.randomUUID> => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const operation = ToolOperationView.parse({
  id: id(1), sourceRunId: id(2), nodeTitle: "登记业务记录", toolId: "private-business-tool", status: "blocked", error: null, receipt: null,
  retryDeadline: "2099-01-01T00:00:00.000Z", resolutions: [], createdAt: "2026-10-10T00:00:00.000Z", updatedAt: "2026-10-10T00:00:00.000Z",
});
const actualReceipt = { 数量: 0, 成功: false, 备注: "", 其他: null, 明细: ["业务记录原内容"] };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetcher = vi.fn<(input: RequestInfo | URL, options?: RequestInit) => Promise<Response>>();
const digest = (input: ToolOperationResolveInput) => createHash("sha256").update(canonicalJson(ToolOperationResolveInput.parse(input))).digest("hex");
const posts = () => fetcher.mock.calls.filter(([, options]) => options?.method === "POST");
const fixed = () => ToolOperationResolveInput.parse(JSON.parse(String(posts()[0][1]?.body)) as unknown);
function found(input = fixed()) {
  return ToolOperationView.parse({ ...operation, resolutions: [{ requestId: input.requestId, kind: input.kind, reason: "业务系统核对依据", createdBy: id(4), createdAt: operation.updatedAt, requestHash: digest(input) }] });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  fetcher.mockReset();
  fetcher.mockImplementation(async (input, options) => {
    if (options?.method === "POST") return response({ ok: false, error: "仅供内部调试", retryable: true }, 503);
    return String(input).startsWith("/api/tool-operations?")
      ? response({ ok: true, items: [ToolOperationSummary.parse({ ...operation, resolutionCount: 0 })], nextCursor: null })
      : response({ ok: true, operation });
  });
  vi.stubGlobal("fetch", fetcher); vi.stubGlobal("isSecureContext", true); vi.stubGlobal("crypto", webcrypto);
  vi.spyOn(crypto, "randomUUID").mockReturnValue(id(3));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function submitOriginal() {
  const user = userEvent.setup();
  fireEvent.change(screen.getByLabelText("核对依据"), { target: { value: "已在业务系统查询原始登记记录" } });
  fireEvent.change(screen.getByLabelText("实际业务回执", { exact: false }), { target: { value: JSON.stringify(actualReceipt) } });
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "检查并保存核对结论" }));
  await user.click(screen.getByRole("button", { name: "确认保存核对结论" }));
  return user;
}
async function start() {
  const rendered = render(<ToolOperationWorkbench initialFilters={{ limit: 20 }} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "查看登记业务记录的核对记录" }));
  await screen.findByRole("checkbox");
  await submitOriginal();
  await waitFor(() => expect(screen.getByRole("button", { name: "核对最新记录" })).toBeEnabled());
  return rendered;
}
function expectProtected() {
  expect(screen.getByLabelText("记录状态")).toBeDisabled();
  expect(screen.getByRole("button", { name: "重新读取列表" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "查看登记业务记录的核对记录" })).toBeDisabled();
  const leave = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(leave); expect(leave.defaultPrevented).toBe(true);
  expect(posts()).toHaveLength(1); expect(crypto.randomUUID).toHaveBeenCalledOnce();
  expect(fixed()).toMatchObject({ operationId: operation.id, requestId: id(3), receipt: actualReceipt });
}

describe("真实工作台、原请求和只读恢复组合", () => {
  it("慢读中止只取消GET，迟到响应不解锁，手动重读严格同请求才更新历史", async () => {
    const { container } = await start();
    const original = fixed(); const first = deferred<Response>(), second = deferred<Response>();
    fetcher.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "核对最新记录" }));
    const initialSignal = fetcher.mock.calls.at(-1)?.[1]?.signal;
    expect(initialSignal).toBeInstanceOf(AbortSignal); expect(initialSignal?.aborted).toBe(false);
    expect(posts()[0][1]?.signal).toBeUndefined();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(within(screen.getByRole("region", { name: "填写核对结论" })).getByRole("status")).toHaveTextContent("读取与核对较慢");
    expectProtected();
    fireEvent.click(screen.getByRole("button", { name: "中止本次读取" }));
    expect(initialSignal?.aborted).toBe(true); expect(screen.getByRole("button", { name: "核对最新记录" })).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent("原提交及全部内容仍保留"); expectProtected();
    expect(screen.getByRole("button", { name: "重发同一次核对请求" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "核对最新记录" }));
    await act(async () => { first.resolve(response({ ok: true, operation: found(original) })); });
    expectProtected(); expect(screen.getByRole("button", { name: "核对最新记录" })).toBeDisabled();
    vi.useRealTimers();
    await act(async () => { second.resolve(response({ ok: true, operation: found(original) })); });
    await waitFor(() => expect(screen.getByLabelText("记录状态")).toBeEnabled());
    expect(within(screen.getByRole("region", { name: "填写核对结论" })).getByRole("status")).toHaveTextContent("这里只确认结论已登记");
    expect(screen.getByRole("region", { name: "核对历史" })).toHaveTextContent("第1次核对");
    expect(posts()).toHaveLength(1); expect(fixed()).toEqual(original);
    expect(fetcher.mock.calls.slice(-2).map(([input]) => String(input))).toEqual([`/api/tool-operations/${operation.id}`, `/api/tool-operations/${operation.id}`]);
    expect(container.textContent).not.toMatch(/private-business-tool|00000000|[a-f0-9]{64}/);
  });

  it("原POST未结束没有中止业务入口、自动历史读取或第二次写入", async () => {
    const pending = deferred<Response>(); fetcher.mockImplementationOnce(() => pending.promise);
    const lock = vi.fn(), observed = vi.fn();
    render(<ToolOperationReconciliationForm operation={operation} onLockChange={lock} onObserved={observed} />);
    await submitOriginal();
    expect(posts()).toHaveLength(1); expect(fetcher).toHaveBeenCalledOnce();
    expect(posts()[0][1]?.signal).toBeUndefined();
    expect(screen.getByRole("button", { name: "核对最新记录" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "中止本次读取" })).not.toBeInTheDocument();
    await act(async () => { pending.resolve(response({ ok: false, retryable: true, error: "保存结果未知" }, 503)); });
    expect(screen.getByRole("button", { name: "核对最新记录" })).toBeEnabled();
    expect(lock).toHaveBeenLastCalledWith(true); expect(observed).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each(["wrong-source", "wrong-hash", "duplicate", "full-history"] as const)("%s 证据不能解除实际工作台保护或开放原请求重发", async (kind) => {
    await start();
    const view = found();
    const current = ToolOperationView.parse({ ...view,
      sourceRunId: kind === "wrong-source" ? id(8) : view.sourceRunId,
      resolutions: kind === "wrong-hash" ? [{ ...view.resolutions[0], requestHash: "a".repeat(64) }]
        : kind === "duplicate" ? [view.resolutions[0], view.resolutions[0]]
        : kind === "full-history" ? [view.resolutions[0], ...Array.from({ length: 49 }, (_, index) => ({ ...view.resolutions[0], requestId: id(100 + index) }))]
        : view.resolutions,
    });
    fetcher.mockResolvedValueOnce(response({ ok: true, operation: current }));
    fireEvent.click(screen.getByRole("button", { name: "核对最新记录" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("仍不能确认本次提交"));
    expectProtected(); expect(screen.getByRole("button", { name: "重发同一次核对请求" })).toBeDisabled();
  });

  it("缺少安全摘要和读取失败均保留未知，不暴露内部错误或重发", async () => {
    await start(); vi.stubGlobal("isSecureContext", false);
    fetcher.mockResolvedValueOnce(response({ ok: true, operation: found() }));
    fireEvent.click(screen.getByRole("button", { name: "核对最新记录" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("仍不能确认本次提交"));
    expectProtected();
    fetcher.mockRejectedValueOnce(new Error("requestId=private-debug-token"));
    fireEvent.click(screen.getByRole("button", { name: "核对最新记录" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("最新历史未取得"));
    expect(screen.getByRole("alert")).not.toHaveTextContent("private-debug-token");
    expect(screen.getByRole("button", { name: "重发同一次核对请求" })).toBeDisabled(); expectProtected();
  });

  it("完整可核对空历史仅开放显式重发确认，两次POST内容完全相同且不新建标识", async () => {
    await start(); const original = fixed();
    fetcher.mockResolvedValueOnce(response({ ok: true, operation }));
    fireEvent.click(screen.getByRole("button", { name: "核对最新记录" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "重发同一次核对请求" })).toBeEnabled());
    expectProtected();
    const user = userEvent.setup(); await user.click(screen.getByRole("button", { name: "重发同一次核对请求" }));
    expect(posts()).toHaveLength(1);
    expect(screen.getByRole("dialog")).toHaveTextContent("不会生成新的核对请求");
    await user.click(screen.getByRole("button", { name: "返回" })); expect(posts()).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "重发同一次核对请求" }));
    fetcher.mockResolvedValueOnce(response({ ok: true }));
    await user.click(screen.getByRole("button", { name: "确认重发原核对请求" }));
    await waitFor(() => expect(screen.getByLabelText("记录状态")).toBeEnabled());
    expect(posts()).toHaveLength(2); expect(posts().map(([, options]) => JSON.parse(String(options?.body)) as unknown)).toEqual([original, original]);
    expect(crypto.randomUUID).toHaveBeenCalledOnce();
  });

  it("摘要计算中止后，迟到摘要不能更新真实历史或解除锁定", async () => {
    await start(); const pending = deferred<ArrayBuffer>();
    const spy = vi.spyOn(webcrypto.subtle, "digest").mockImplementation(() => pending.promise);
    fetcher.mockResolvedValueOnce(response({ ok: true, operation: found() }));
    fireEvent.click(screen.getByRole("button", { name: "核对最新记录" }));
    await waitFor(() => expect(spy).toHaveBeenCalledOnce());
    const readSignal = fetcher.mock.calls.at(-1)?.[1]?.signal;
    fireEvent.click(screen.getByRole("button", { name: "中止本次读取" }));
    const bytes = Uint8Array.from(createHash("sha256").update(canonicalJson(fixed())).digest());
    await act(async () => { pending.resolve(bytes.buffer); });
    expect(readSignal?.aborted).toBe(true); expectProtected();
    expect(screen.getByRole("region", { name: "核对历史" })).not.toHaveTextContent("第1次核对");
  });

  it("真实父表单来源A→B→A不会重新接受旧响应或旧代次", async () => {
    const lock = vi.fn(), observed = vi.fn();
    const { rerender } = render(<ToolOperationReconciliationForm operation={operation} onLockChange={lock} onObserved={observed} />);
    await submitOriginal(); const pending = deferred<Response>(); fetcher.mockImplementationOnce(() => pending.promise);
    fireEvent.click(screen.getByRole("button", { name: "核对最新记录" }));
    const signal = fetcher.mock.calls.at(-1)?.[1]?.signal;
    rerender(<ToolOperationReconciliationForm operation={{ ...operation, sourceRunId: id(8) }} onLockChange={lock} onObserved={observed} />);
    rerender(<ToolOperationReconciliationForm operation={operation} onLockChange={lock} onObserved={observed} />);
    await act(async () => { pending.resolve(response({ ok: true, operation: found() })); });
    expect(signal?.aborted).toBe(true); expect(observed).not.toHaveBeenCalled(); expect(lock).toHaveBeenLastCalledWith(true);
    expect(screen.getByRole("alert")).toHaveTextContent("所属任务已变化"); expect(screen.getByRole("button", { name: "核对最新记录" })).toBeDisabled();
    expect(posts()).toHaveLength(1); expect(crypto.randomUUID).toHaveBeenCalledOnce();
  });

  it("真实保存成功确认不会被随后中止或缺失历史降为未知，也不开放重发", async () => {
    const lock = vi.fn(), observed = vi.fn();
    fetcher.mockResolvedValueOnce(response({ ok: true }));
    render(<ToolOperationReconciliationForm operation={operation} onLockChange={lock} onObserved={observed} />);
    await submitOriginal();
    expect(screen.getByRole("status")).toHaveTextContent("核对记录已保存");
    const pending = deferred<Response>(); fetcher.mockImplementationOnce(() => pending.promise);
    fireEvent.click(screen.getByRole("button", { name: "核对最新记录" }));
    fireEvent.click(screen.getByRole("button", { name: "中止本次读取" }));
    expect(screen.getByRole("status")).toHaveTextContent("保存确认仍保留"); expect(lock).toHaveBeenLastCalledWith(false);
    await act(async () => { pending.resolve(response({ ok: true, operation })); });
    fetcher.mockResolvedValueOnce(response({ ok: true, operation }));
    fireEvent.click(screen.getByRole("button", { name: "核对最新记录" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("不据此否定保存或重发"));
    expect(screen.queryByRole("button", { name: "重发同一次核对请求" })).not.toBeInTheDocument();
    expect(lock).toHaveBeenLastCalledWith(false); expect(posts()).toHaveLength(1);
  });

  it("原POST来源换绑后迟到成功回执不更新当前记录，未知保护继续", async () => {
    const pending = deferred<Response>(); fetcher.mockImplementationOnce(() => pending.promise);
    const lock = vi.fn(), observed = vi.fn();
    const { rerender } = render(<ToolOperationReconciliationForm operation={operation} onLockChange={lock} onObserved={observed} />);
    await submitOriginal();
    rerender(<ToolOperationReconciliationForm operation={{ ...operation, sourceRunId: id(8) }} onLockChange={lock} onObserved={observed} />);
    rerender(<ToolOperationReconciliationForm operation={operation} onLockChange={lock} onObserved={observed} />);
    await act(async () => { pending.resolve(response({ ok: true })); });
    expect(screen.getByRole("alert")).toHaveTextContent("所属任务已变化");
    expect(observed).not.toHaveBeenCalled(); expect(lock).toHaveBeenLastCalledWith(true);
    expect(screen.queryByText(/核对记录已保存/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "核对最新记录" })).toBeDisabled(); expect(posts()).toHaveLength(1);
  });

  it("提交前确认弹窗的来源ABA也不能复用原确认，填写内容仍保留", async () => {
    const lock = vi.fn(), observed = vi.fn(); const user = userEvent.setup();
    const { rerender } = render(<ToolOperationReconciliationForm operation={operation} onLockChange={lock} onObserved={observed} />);
    fireEvent.change(screen.getByLabelText("核对依据"), { target: { value: "已在业务系统查询原始登记记录" } });
    fireEvent.change(screen.getByLabelText("实际业务回执", { exact: false }), { target: { value: JSON.stringify(actualReceipt) } });
    await user.click(screen.getByRole("checkbox")); await user.click(screen.getByRole("button", { name: "检查并保存核对结论" }));
    rerender(<ToolOperationReconciliationForm operation={{ ...operation, sourceRunId: id(8) }} onLockChange={lock} onObserved={observed} />);
    rerender(<ToolOperationReconciliationForm operation={operation} onLockChange={lock} onObserved={observed} />);
    await user.click(screen.getByRole("button", { name: "确认保存核对结论" }));
    expect(posts()).toHaveLength(0); expect(observed).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toHaveTextContent("发生变化");
    expect(screen.getByLabelText("实际业务回执", { exact: false })).toHaveValue(JSON.stringify(actualReceipt));
  });
});
