import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DefaultResultDeliveryView } from "@/contracts/default-result-delivery";
import { DefaultResultRecoveryPanel } from "@/features/runs/DefaultResultRecoveryPanel";

const runId = "00000000-0000-4000-8000-000000000181";
const otherId = "00000000-0000-4000-8000-000000000182";
const date = "2026-10-19T01:00:00.000Z";
const fetchMock = vi.fn();
function delivery(overrides: Partial<DefaultResultDeliveryView> = {}) {
  return DefaultResultDeliveryView.parse({ runId, status: "ready", writeAttempts: 0, error: null,
    createdAt: date, updatedAt: date, confirmedAt: overrides.status === "confirmed" ? date : null, canRetry: true, canVerify: true, ...overrides });
}
function response(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...extra } });
}
const query = (value: DefaultResultDeliveryView | null = delivery()) => response({ delivery: value }, value ? 200 : 404);
const recovery = (value = delivery({ status: "confirmed", canRetry: false, canVerify: true, confirmedAt: date })) => response({ ok: true, delivery: value, workflowNotified: value.canVerify });
const posts = () => fetchMock.mock.calls.filter((call) => (call[1] as RequestInit | undefined)?.method === "POST");
async function mountReady() {
  const view = render(<DefaultResultRecoveryPanel runId={runId} />);
  await screen.findByText("已保存，可继续处理"); return view;
}
async function confirmRetry(user = userEvent.setup()) {
  await user.click(screen.getByRole("button", { name: "继续发送已保存成果" }));
  await user.click(screen.getByRole("button", { name: "确认继续发送" }));
}
beforeEach(() => { fetchMock.mockReset(); fetchMock.mockImplementation(async () => query()); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("主流程成果确认的真实契约接线", () => {
  it("首次只读同源默认成果端点，不混用外部投递、不自动提交", async () => {
    await mountReady();
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(`/api/runs/${runId}/default-result`, expect.objectContaining({ method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error", signal: expect.any(AbortSignal) }));
    expect(posts()).toHaveLength(0); expect(screen.getByText(/不会重新运行模型或工具/)).toBeVisible();
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(true);
  });
  it("非法任务关联不发请求，合法UUID归一后再核对响应归属", async () => {
    const view = render(<DefaultResultRecoveryPanel runId="not-a-run" />);
    expect(screen.getByRole("alert")).toHaveTextContent("任务关联无法核对"); expect(fetchMock).not.toHaveBeenCalled();
    const id = "abcdef01-abcd-4abc-8abc-abcdefabcdef";
    fetchMock.mockImplementation(async () => query(delivery({ runId: id })));
    view.rerender(<DefaultResultRecoveryPanel runId={id.toUpperCase()} />);
    await screen.findByText("已保存，可继续处理");
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/runs/${id}/default-result`);
  });
  it("404且契约为null才显示未读到记录，不把它当成成果丢失", async () => {
    fetchMock.mockImplementation(async () => query(null));
    render(<DefaultResultRecoveryPanel runId={runId} />);
    expect(await screen.findByText(/不能据此判断成果丢失/)).toBeVisible();
    expect(screen.getByRole("button", { name: "继续发送已保存成果" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "核对成果与流程通知" })).toBeDisabled(); expect(posts()).toHaveLength(0);
  });
  it.each([
    ["sending", false, true], ["waiting_review", false, true], ["confirmed", false, true],
    ["failed", false, false], ["ready", true, false],
  ] as const)("%s严格按服务端flag提供操作，终态不再次发送", async (status, canRetry, canVerify) => {
    fetchMock.mockImplementation(async () => query(delivery({ status, canRetry, canVerify })));
    render(<DefaultResultRecoveryPanel runId={runId} />);
    await waitFor(() => expect(screen.queryByText("正在读取成果确认记录…")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "继续发送已保存成果" })).toHaveProperty("disabled", !canRetry);
    expect(screen.getByRole("button", { name: "核对成果与流程通知" })).toHaveProperty("disabled", !canVerify);
    expect(posts()).toHaveLength(0);
  });
  it.each(["network", "wrong-run", "wrong-status", "wrong-shape", "oversize"])("读取%s属于未知，不显示原始错误或开放重发", async (kind) => {
    fetchMock.mockImplementation(async () => {
      if (kind === "network") throw new Error("sk-private-read-error");
      if (kind === "wrong-run") return query(delivery({ runId: otherId }));
      if (kind === "wrong-status") return response({ delivery: delivery() }, 503);
      if (kind === "oversize") return response({ delivery: delivery(), extra: "x".repeat(17 * 1024) });
      return response({ ok: false, error: "sk-private-read-error" }, 404);
    });
    const { container } = render(<DefaultResultRecoveryPanel runId={runId} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("状态未知");
    expect(container.textContent).not.toContain("sk-private"); expect(posts()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "继续发送已保存成果" })).toBeDisabled();
  });
  it("继续发送必须明确确认；取消保留记录、返回焦点且不提交", async () => {
    await mountReady(); const user = userEvent.setup(); const button = screen.getByRole("button", { name: "继续发送已保存成果" });
    await user.click(button); expect(screen.getByRole("dialog")).toHaveTextContent("不重新运行模型或工具");
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(false);
    await user.keyboard("{Escape}"); expect(button).toHaveFocus(); expect(posts()).toHaveLength(0);
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(true);
  });
  it("明确继续仅发送契约mode，双击不能产生第二次写入", async () => {
    await mountReady(); const user = userEvent.setup(); let resolve!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
    await user.click(screen.getByRole("button", { name: "继续发送已保存成果" }));
    const confirm = screen.getByRole("button", { name: "确认继续发送" });
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(posts()).toHaveLength(1);
    expect(posts()[0]).toEqual([`/api/runs/${runId}/default-result`, expect.objectContaining({ method: "POST", body: JSON.stringify({ mode: "retry" }), credentials: "same-origin", redirect: "error", headers: { "content-type": "application/json" } })]);
    await act(async () => { resolve(recovery()); });
    expect(await screen.findByText("执行系统已确认成果")).toBeVisible();
    expect(screen.getByRole("button", { name: "继续发送已保存成果" })).toBeDisabled();
    expect(screen.getByText(/通知已提交；请结合任务状态/)).toBeVisible();
  });
  it("核对使用独立verify且不打开发送确认，不自动重新运行业务", async () => {
    await mountReady(); fetchMock.mockImplementationOnce(async () => recovery());
    await userEvent.click(screen.getByRole("button", { name: "核对成果与流程通知" }));
    await screen.findByText("执行系统已确认成果");
    expect(posts()).toHaveLength(1); expect(JSON.parse(posts()[0][1].body)).toEqual({ mode: "verify" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("未知retry提交保留线索；GET仍可读却不能洗成未提交，只有verify回执解除未知", async () => {
    await mountReady(); const user = userEvent.setup();
    fetchMock.mockRejectedValueOnce(new Error("private-write-error")); await confirmRetry(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("本次提交尚不能确认");
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(false);
    expect(screen.getByRole("button", { name: "继续发送已保存成果" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "重新读取成果记录" }));
    await screen.findByText("已保存，可继续处理");
    expect(screen.getByRole("alert")).toHaveTextContent("重新读取记录不能单独证明上次提交未处理");
    expect(screen.getByRole("button", { name: "继续发送已保存成果" })).toBeDisabled(); expect(posts()).toHaveLength(1);
    fetchMock.mockImplementationOnce(async () => response({ ok: true, delivery: delivery(), workflowNotified: false }));
    await user.click(screen.getByRole("button", { name: "核对成果与流程通知" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "继续发送已保存成果" })).toBeEnabled();
    expect(posts().map((call) => JSON.parse(call[1].body).mode)).toEqual(["retry", "verify"]);
  });
  it.each(["wrong-run", "wrong-shape", "200-pending", "202-not-pending", "503", "html", "invalid-utf8"])("写回%s不能冒称成功，不泄漏响应或盲目重发", async (kind) => {
    await mountReady(); const cancel = vi.fn();
    fetchMock.mockImplementationOnce(async () => {
      if (kind === "wrong-run") return recovery(delivery({ runId: otherId }));
      if (kind === "wrong-shape") return response({ error: "private-response-data" });
      if (kind === "503") return response({ ok: false, error: "private-response-data", retryable: true }, 503);
      if (kind === "html") return new Response("private-response-data", { headers: { "content-type": "text/html" } });
      if (kind === "invalid-utf8") return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([255])); }, cancel }), { headers: { "content-type": "application/json" } });
      const terminal = delivery({ status: "confirmed", canRetry: false, canVerify: true, confirmedAt: date });
      return response({ ok: true, delivery: terminal, workflowNotified: false, ...(kind === "200-pending" ? { workflowNotificationPending: true } : {}) }, kind === "200-pending" ? 200 : 202);
    });
    await confirmRetry();
    expect(await screen.findByRole("alert")).toHaveTextContent("本次提交尚不能确认");
    expect(screen.getByRole("button", { name: "继续发送已保存成果" })).toBeDisabled(); expect(posts()).toHaveLength(1);
    expect(document.body.textContent).not.toContain("private-response-data");
    if (kind === "invalid-utf8") expect(cancel).toHaveBeenCalledOnce();
  });
  it.each(["confirmed", "failed"] as const)("未知提交后GET已是%s且无等待入口，仍能显式只核对原请求，不允许再次发送", async (status) => {
    await mountReady(); const user = userEvent.setup();
    fetchMock.mockRejectedValueOnce(new Error("lost response")); await confirmRetry(user);
    await screen.findByRole("alert");
    const terminal = delivery({ status, canRetry: false, canVerify: false });
    fetchMock.mockImplementationOnce(async () => query(terminal));
    await user.click(screen.getByRole("button", { name: "重新读取成果记录" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "核对成果与流程通知" })).toBeEnabled());
    expect(screen.getByRole("alert")).toHaveTextContent("本次提交尚不能确认");
    expect(screen.getByRole("button", { name: "继续发送已保存成果" })).toBeDisabled();
    fetchMock.mockImplementationOnce(async () => recovery(terminal));
    await user.click(screen.getByRole("button", { name: "核对成果与流程通知" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(posts().map((call) => JSON.parse(call[1].body).mode)).toEqual(["retry", "verify"]);
    expect(screen.getByRole("button", { name: "继续发送已保存成果" })).toBeDisabled();
  });
  it.each(["confirmed", "failed"] as const)("202保留%s和通知待核对，GET不清除；按Retry-After冷却后仅手动verify", async (status) => {
    await mountReady(); vi.useFakeTimers();
    const terminal = delivery({ status, canRetry: false, canVerify: true, confirmedAt: status === "confirmed" ? date : null });
    fetchMock.mockImplementationOnce(async () => response({ ok: true, delivery: terminal, workflowNotified: false, workflowNotificationPending: true }, 202, { "retry-after": "2" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "核对成果与流程通知" })); });
    expect(screen.getByText(/成果状态已保留，但流程通知尚未确认/)).toBeVisible();
    const verify = screen.getByRole("button", { name: "核对成果与流程通知" }); expect(verify).toBeDisabled();
    expect(screen.getByRole("button", { name: "继续发送已保存成果" })).toBeDisabled();
    fetchMock.mockImplementationOnce(async () => query(terminal));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "重新读取成果记录" })); });
    expect(screen.getByText(/成果状态已保留，但流程通知尚未确认/)).toBeVisible();
    await act(async () => { await vi.advanceTimersByTimeAsync(1999); }); expect(verify).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); }); expect(verify).toBeEnabled(); expect(posts()).toHaveLength(1);
    fetchMock.mockImplementationOnce(async () => recovery({ ...terminal, canVerify: false }));
    await act(async () => { fireEvent.click(verify); });
    expect(screen.queryByText(/成果状态已保留，但流程通知尚未确认/)).not.toBeInTheDocument();
    expect(posts().map((call) => JSON.parse(call[1].body).mode)).toEqual(["verify", "verify"]);
  });
  it.each(["unreadable", "wrong-run"])("未知终态的安全核对例外不能沿用%s的读取", async (kind) => {
    await mountReady(); const user = userEvent.setup(); fetchMock.mockRejectedValueOnce(new Error("lost response"));
    await confirmRetry(user); await screen.findByRole("alert");
    const terminal = delivery({ status: "confirmed", canRetry: false, canVerify: false });
    fetchMock.mockImplementationOnce(async () => query(terminal));
    await user.click(screen.getByRole("button", { name: "重新读取成果记录" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "核对成果与流程通知" })).toBeEnabled());
    if (kind === "unreadable") fetchMock.mockRejectedValueOnce(new Error("read failed"));
    else fetchMock.mockImplementationOnce(async () => query({ ...terminal, runId: otherId }));
    await user.click(screen.getByRole("button", { name: "重新读取成果记录" }));
    await screen.findByText(/成果确认记录暂时无法读取/);
    expect(screen.getByRole("button", { name: "核对成果与流程通知" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "继续发送已保存成果" })).toBeDisabled(); expect(posts()).toHaveLength(1);
    expect(screen.getByText(/本次提交尚不能确认/)).toBeVisible();
  });
  it("写超时保留未知，晚到的旧回执不能覆盖后续verify或误触发发送", async () => {
    await mountReady(); vi.useFakeTimers(); let resolve!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
    fireEvent.click(screen.getByRole("button", { name: "核对成果与流程通知" }));
    const signal = posts()[0][1].signal as AbortSignal;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(signal.aborted).toBe(true); expect(screen.getByRole("alert")).toHaveTextContent("本次提交尚不能确认");
    let second!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((done) => { second = done; }));
    fireEvent.click(screen.getByRole("button", { name: "核对成果与流程通知" }));
    await act(async () => { resolve(response({ ok: true, delivery: delivery(), workflowNotified: false })); });
    expect(screen.getByRole("button", { name: "重新读取成果记录" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "核对成果与流程通知" })).toBeDisabled();
    await act(async () => { second(recovery()); });
    expect(screen.getByText("执行系统已确认成果")).toBeVisible(); expect(posts()).toHaveLength(2);
    expect(screen.getByRole("button", { name: "继续发送已保存成果" })).toBeDisabled();
  });
  it("提交中和未知时保护离开；拒绝离开不丢线索，卸载仅停止本页读写而非后台操作", async () => {
    const view = await mountReady(); let resolve!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((done) => { resolve = done; }));
    fireEvent.click(screen.getByRole("button", { name: "核对成果与流程通知" }));
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(false);
    const anchor = document.createElement("a"); anchor.href = "/another-page"; document.body.append(anchor);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    expect(fireEvent.click(anchor)).toBe(false); expect(confirm).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("不会取消后台处理"));
    anchor.remove(); const signal = posts()[0][1].signal as AbortSignal;
    view.unmount(); expect(signal.aborted).toBe(true);
    expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(true);
    await act(async () => { resolve(recovery()); }); expect(posts()).toHaveLength(1);
  });
  it("StrictMode与换任务隔离旧读取，清除自有监听但不沿用前一任务状态", async () => {
    const view = render(<StrictMode><DefaultResultRecoveryPanel runId={runId} /></StrictMode>);
    await screen.findByText("已保存，可继续处理"); expect(posts()).toHaveLength(0);
    let first!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((done) => { first = done; }));
    fireEvent.click(screen.getByRole("button", { name: "重新读取成果记录" }));
    const signal = fetchMock.mock.lastCall?.[1].signal as AbortSignal;
    fetchMock.mockImplementation(async () => query(delivery({ runId: otherId, status: "confirmed", canRetry: false, canVerify: false })));
    view.rerender(<StrictMode><DefaultResultRecoveryPanel runId={otherId} /></StrictMode>);
    await screen.findByText("执行系统已确认成果"); expect(signal.aborted).toBe(true);
    await act(async () => { first(query()); });
    expect(screen.queryByText("已保存，可继续处理")).not.toBeInTheDocument(); expect(posts()).toHaveLength(0);
    view.unmount(); expect(window.dispatchEvent(new Event("beforeunload", { cancelable: true }))).toBe(true);
  });
  it("强制换任务时隔离旧POST，客户端中止不被当作后台未处理或新任务待通知", async () => {
    const view = await mountReady(); let first!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((done) => { first = done; }));
    fireEvent.click(screen.getByRole("button", { name: "核对成果与流程通知" }));
    const signal = posts()[0][1].signal as AbortSignal;
    fetchMock.mockImplementation(async () => query(delivery({ runId: otherId })));
    view.rerender(<DefaultResultRecoveryPanel runId={otherId} />);
    await screen.findByText("已保存，可继续处理"); expect(signal.aborted).toBe(true);
    await act(async () => { first(response({ ok: true, delivery: delivery({ status: "confirmed", canRetry: false, canVerify: true }), workflowNotified: false, workflowNotificationPending: true }, 202)); });
    expect(screen.queryByText(/成果状态已保留，但流程通知尚未确认/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "继续发送已保存成果" })).toBeEnabled(); expect(posts()).toHaveLength(1);
    expect(posts()[0][0]).toBe(`/api/runs/${runId}/default-result`);
  });
});
