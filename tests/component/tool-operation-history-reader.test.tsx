import { createHash } from "node:crypto";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolOperationResolveInput, ToolOperationView, type ToolOperationGetResult } from "@/contracts/tool-operation";
import { canonicalJson } from "@/server/domain/canonical-json";
import { ToolOperationHistoryReader } from "@/features/tool-operations/ToolOperationHistoryReader";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const sourceRunId = id(2);
const input = ToolOperationResolveInput.parse({
  operationId: id(1), requestId: id(3), kind: "record-receipt", confirmedCompleted: true,
  reason: "已查询业务系统实际登记记录", receipt: { number: "登记示例", flags: { confirmed: false }, items: ["实际保存的内容"] },
});
const digest = (payload: ToolOperationResolveInput) => createHash("sha256").update(canonicalJson(ToolOperationResolveInput.parse(payload))).digest("hex");
function reply(payload = input): ToolOperationGetResult {
  return {
    ok: true, operation: ToolOperationView.parse({
      id: payload.operationId, sourceRunId, nodeTitle: "登记步骤", toolId: "internal-registered-tool", status: "blocked", error: null, receipt: null,
      retryDeadline: "2026-10-11T01:00:00.000Z", createdAt: "2026-10-10T01:00:00.000Z", updatedAt: "2026-10-10T01:00:00.000Z",
      resolutions: [{ requestId: payload.requestId, kind: payload.kind, reason: payload.reason, requestHash: digest(payload), createdBy: id(4), createdAt: "2026-10-10T01:00:00.000Z" }],
    }),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}
function clients(read: (operationId: string, signal: AbortSignal) => Promise<ToolOperationGetResult> = async () => reply()) {
  return { read: vi.fn(read), hashPayload: vi.fn(async (payload: ToolOperationResolveInput): Promise<string | null> => digest(payload)), onRecorded: vi.fn() };
}
const network = vi.fn();
beforeEach(() => { network.mockReset(); vi.stubGlobal("fetch", network); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("固定原提交历史读取叶子", () => {
  it("挂载与绑定不自动请求，普通界面不显示内部标识或业务回执", () => {
    const client = clients();
    const { container } = render(<ToolOperationHistoryReader payload={input} sourceRunId={sourceRunId} requestGeneration={1} readEnabled {...client} />);
    expect(screen.getByRole("button", { name: "手动读取原请求历史" })).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent("提交结果尚未核实");
    expect(screen.queryByRole("button", { name: "中止本次读取" })).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/00000000|requestId|sourceRunId|internal-registered-tool|实际保存的内容/);
    expect(client.read).not.toHaveBeenCalled();
    expect(client.hashPayload).not.toHaveBeenCalled();
    expect(client.onRecorded).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });

  it("慢读可显式中止GET，再手动重读同一原请求，迟到旧结果不确认", async () => {
    vi.useFakeTimers();
    const first = deferred<ToolOperationGetResult>(), second = deferred<ToolOperationGetResult>();
    const client = clients();
    client.read.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    render(<ToolOperationHistoryReader payload={input} sourceRunId={sourceRunId} requestGeneration={1} readEnabled {...client} />);
    fireEvent.click(screen.getByRole("button", { name: "手动读取原请求历史" }));
    expect(client.read).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "手动读取原请求历史" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "中止本次读取" })).toBeEnabled();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByRole("status")).toHaveTextContent("读取与核对较慢");
    expect(client.read).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "中止本次读取" }));
    expect(client.read.mock.calls[0][1].aborted).toBe(true);
    expect(screen.getByRole("alert")).toHaveTextContent("原提交及全部内容仍保留");
    expect(screen.getByRole("button", { name: "手动读取原请求历史" })).toHaveFocus();
    act(() => { vi.advanceTimersByTime(0); });
    expect(vi.getTimerCount()).toBe(0);
    act(() => { vi.advanceTimersByTime(10000); });
    expect(client.read).toHaveBeenCalledOnce(); expect(client.hashPayload).not.toHaveBeenCalled(); expect(client.onRecorded).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("提交结果仍未知");
    expect(screen.getByRole("button", { name: "手动读取原请求历史" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "中止本次读取" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "手动读取原请求历史" }));
    expect(client.read).toHaveBeenCalledTimes(2);
    expect(client.read.mock.calls.map(([operationId]) => operationId)).toEqual([input.operationId, input.operationId]);
    await act(async () => { first.resolve(reply()); });
    expect(client.onRecorded).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("正在读取并核对原请求历史");
    await act(async () => { second.resolve(reply()); });
    expect(client.hashPayload).toHaveBeenCalledOnce();
    expect(client.hashPayload).toHaveBeenCalledWith(input);
    expect(client.onRecorded).toHaveBeenCalledWith(expect.anything(), input, sourceRunId, 1);
    expect(screen.getByRole("status")).toHaveTextContent("这里只确认结论已登记");
    expect(screen.getByRole("status")).toHaveTextContent("不表示业务工具执行成功、旧任务恢复");
    act(() => { vi.advanceTimersByTime(0); });
    expect(vi.getTimerCount()).toBe(0);
    expect(network).not.toHaveBeenCalled();
  });

  it("中止和未知结果不解除父页面的离开保护", async () => {
    const response = deferred<ToolOperationGetResult>();
    const client = clients(() => response.promise);
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    try {
      render(<ToolOperationHistoryReader payload={input} sourceRunId={sourceRunId} requestGeneration={1} readEnabled {...client} />);
      fireEvent.click(screen.getByRole("button", { name: "手动读取原请求历史" }));
      fireEvent.click(screen.getByRole("button", { name: "中止本次读取" }));
      await act(async () => { response.resolve({ ok: false, error: "原提交状态未确认" }); });
      const leave = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(leave);
      expect(leave.defaultPrevented).toBe(true);
      expect(client.onRecorded).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent("提交结果仍未知");
    } finally { window.removeEventListener("beforeunload", warn); }
  });

  it("请求A→B→A更换代次后旧响应不覆盖当前请求，也不自动开始新读取", async () => {
    const first = deferred<ToolOperationGetResult>(), current = deferred<ToolOperationGetResult>();
    const client = clients();
    client.read.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => current.promise);
    const { rerender } = render(<ToolOperationHistoryReader payload={input} sourceRunId={sourceRunId} requestGeneration={1} readEnabled {...client} />);
    fireEvent.click(screen.getByRole("button", { name: "手动读取原请求历史" }));
    const other = ToolOperationResolveInput.parse({ ...input, requestId: id(9) });
    rerender(<ToolOperationHistoryReader payload={other} sourceRunId={sourceRunId} requestGeneration={2} readEnabled {...client} />);
    rerender(<ToolOperationHistoryReader payload={input} sourceRunId={sourceRunId} requestGeneration={3} readEnabled {...client} />);
    expect(client.read).toHaveBeenCalledOnce();
    expect(client.read.mock.calls[0][1].aborted).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "手动读取原请求历史" }));
    await act(async () => { first.resolve(reply()); });
    expect(client.onRecorded).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("正在读取");
    await act(async () => { current.resolve(reply()); });
    expect(client.onRecorded).toHaveBeenCalledOnce();
    expect(client.onRecorded).toHaveBeenCalledWith(expect.anything(), input, sourceRunId, 3);
  });

  it("同代次更换完整内容后拒绝读取，恢复旧内容也须新代次", async () => {
    const client = clients();
    const { rerender } = render(<ToolOperationHistoryReader payload={input} sourceRunId={sourceRunId} requestGeneration={1} readEnabled {...client} />);
    const changed = ToolOperationResolveInput.parse({ ...input, reason: "同代次替换的业务核对说明" });
    rerender(<ToolOperationHistoryReader payload={changed} sourceRunId={sourceRunId} requestGeneration={1} readEnabled {...client} />);
    expect(screen.getByRole("button", { name: "手动读取原请求历史" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("原请求无法确认，当前不能读取");
    rerender(<ToolOperationHistoryReader payload={input} sourceRunId={sourceRunId} requestGeneration={1} readEnabled {...client} />);
    expect(screen.getByRole("button", { name: "手动读取原请求历史" })).toBeDisabled();
    expect(client.read).not.toHaveBeenCalled();
    rerender(<ToolOperationHistoryReader payload={input} sourceRunId={sourceRunId} requestGeneration={2} readEnabled {...client} />);
    fireEvent.click(screen.getByRole("button", { name: "手动读取原请求历史" }));
    await screen.findByText(/已在可核对历史中找到本次核对记录/);
    expect(client.onRecorded).toHaveBeenCalledWith(expect.anything(), input, sourceRunId, 2);
  });

  it("卸载会中止并清理，卸载后迟到的响应和摘要都不能回调", async () => {
    const response = deferred<ToolOperationGetResult>();
    const client = clients(() => response.promise);
    const { unmount } = render(<ToolOperationHistoryReader payload={input} sourceRunId={sourceRunId} requestGeneration={1} readEnabled {...client} />);
    fireEvent.click(screen.getByRole("button", { name: "手动读取原请求历史" }));
    unmount();
    expect(client.read.mock.calls[0][1].aborted).toBe(true);
    await act(async () => { response.resolve(reply()); });
    expect(client.hashPayload).not.toHaveBeenCalled();
    expect(client.onRecorded).not.toHaveBeenCalled();
  });

  it("缺失实际摘要保持未知，读取错误细节不出现在普通文案", async () => {
    const client = clients();
    client.hashPayload.mockResolvedValue(null);
    render(<ToolOperationHistoryReader payload={input} sourceRunId={sourceRunId} requestGeneration={1} readEnabled {...client} />);
    fireEvent.click(screen.getByRole("button", { name: "手动读取原请求历史" }));
    await screen.findByText(/最新历史仍不能确认本次提交/);
    expect(client.onRecorded).not.toHaveBeenCalled();
    client.read.mockRejectedValueOnce(new Error("服务内部调试内容 requestId=private-value"));
    fireEvent.click(screen.getByRole("button", { name: "手动读取原请求历史" }));
    await screen.findByText(/最新历史未取得或无法核对/);
    expect(screen.queryByText(/private-value|内部调试|requestId=/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "手动读取原请求历史" })).toBeEnabled();
  });

  it("不一致归属和50条历史覆盖边界仍未知，不通知已记录", async () => {
    const client = clients();
    const recorded = reply();
    if (!recorded.ok) throw new Error("Fixture mismatch");
    client.read.mockResolvedValueOnce({ ok: true, operation: { ...recorded.operation, sourceRunId: id(8) } });
    render(<ToolOperationHistoryReader payload={input} sourceRunId={sourceRunId} requestGeneration={1} readEnabled {...client} />);
    fireEvent.click(screen.getByRole("button", { name: "手动读取原请求历史" }));
    await screen.findByText(/核对详情与本次操作所属任务不一致/);
    expect(screen.getByRole("alert")).toHaveTextContent("仍不能确认本次提交");
    expect(screen.getByRole("button", { name: "手动读取原请求历史" })).toBeEnabled();
    expect(client.hashPayload).not.toHaveBeenCalled();
    expect(client.onRecorded).not.toHaveBeenCalled();
    const records = recorded.operation.resolutions;
    client.read.mockResolvedValueOnce({ ok: true, operation: { ...recorded.operation, resolutions: [records[0], ...Array.from({ length: 49 }, (_, index) => ({ ...records[0], requestId: id(100 + index) }))] } });
    fireEvent.click(screen.getByRole("button", { name: "手动读取原请求历史" }));
    await screen.findByText(/最新历史仍不能确认本次提交/);
    expect(client.onRecorded).not.toHaveBeenCalled();
    expect(client.hashPayload).not.toHaveBeenCalled();
    expect(client.read).toHaveBeenCalledTimes(2);
  });

  it("慢读提示触发前中止清除自身计时器，之后不自动读取或接受迟到结果", async () => {
    vi.useFakeTimers();
    const timers = vi.spyOn(globalThis, "setTimeout"), clear = vi.spyOn(globalThis, "clearTimeout");
    const pending = deferred<ToolOperationGetResult>(), client = clients(() => pending.promise);
    render(<ToolOperationHistoryReader payload={input} sourceRunId={sourceRunId} requestGeneration={1} readEnabled {...client} />);
    fireEvent.click(screen.getByRole("button", { name: "手动读取原请求历史" }));
    const timerIndex = timers.mock.calls.findIndex(([, delay]) => delay === 5000);
    expect(timerIndex).toBeGreaterThanOrEqual(0);
    const ownTimer = timers.mock.results[timerIndex].value;
    fireEvent.click(screen.getByRole("button", { name: "中止本次读取" }));
    expect(clear).toHaveBeenCalledWith(ownTimer);
    expect(client.read.mock.calls[0][1].aborted).toBe(true);
    expect(screen.getByRole("button", { name: "手动读取原请求历史" })).toHaveFocus();
    act(() => { vi.advanceTimersByTime(0); });
    expect(vi.getTimerCount()).toBe(0);
    act(() => { vi.advanceTimersByTime(6000); });
    expect(screen.getByRole("alert")).toHaveTextContent("原提交及全部内容仍保留");
    expect(screen.queryByText(/读取与核对较慢/)).not.toBeInTheDocument();
    expect(client.read).toHaveBeenCalledOnce(); expect(client.hashPayload).not.toHaveBeenCalled();
    await act(async () => { pending.resolve(reply()); });
    expect(client.onRecorded).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("原提交尚未结束时按钮禁用，不偷偷发起读取", () => {
    const client = clients();
    render(<ToolOperationHistoryReader payload={input} sourceRunId={sourceRunId} requestGeneration={1} readEnabled={false} {...client} />);
    expect(screen.getByRole("button", { name: "手动读取原请求历史" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("先等待原提交结束");
    expect(client.read).not.toHaveBeenCalled();
    expect(client.onRecorded).not.toHaveBeenCalled();
  });

  it("键盘可手动读取和中止，并回到重读按钮", async () => {
    const user = userEvent.setup();
    const response = deferred<ToolOperationGetResult>();
    const client = clients(() => response.promise);
    render(<ToolOperationHistoryReader payload={input} sourceRunId={sourceRunId} requestGeneration={1} readEnabled {...client} />);
    const read = screen.getByRole("button", { name: "手动读取原请求历史" });
    read.focus(); await user.keyboard("{Enter}");
    expect(client.read).toHaveBeenCalledOnce();
    const abort = screen.getByRole("button", { name: "中止本次读取" });
    abort.focus(); await user.keyboard("{Enter}");
    expect(read).toHaveFocus();
    expect(read).toBeEnabled();
    expect(client.read.mock.calls[0][1].aborted).toBe(true);
    await act(async () => { response.resolve(reply()); });
    expect(client.onRecorded).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  });
});
