import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ExecutionPolicySnapshot, type ExecutionPolicyChangeView, type ExecutionPolicyInput,
  type ExecutionPolicyWriteResult, type ExecutionPolicyHistoryResult,
} from "@/contracts/execution-resources";
import { ExecutionResourcesPanel } from "@/features/harness/ExecutionResourcesPanel";
import { GET, POST } from "@/app/api/execution/resources/route";
import { GET as historyGET } from "@/app/api/execution/resources/history/route";

const mocks = vi.hoisted(() => ({ read: vi.fn(), history: vi.fn(), write: vi.fn() }));
vi.mock("@/server/queries/execution-resources", () => ({ getExecutionResourcePolicy: mocks.read, listExecutionPolicyHistory: mocks.history }));
vi.mock("@/server/actions/record-execution-policy", () => ({ recordExecutionPolicyAction: mocks.write }));

const firstRequest = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const secondRequest = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const at = "2026-10-09T01:00:00.000Z";
const initialSnapshot = ExecutionPolicySnapshot.parse({
  policy: { revision: 1, source: "configured", limits: { maxConcurrentChains: 50, maxModelCalls: 200, maxChildRuns: 100 }, updatedAt: at },
  capacity: { reservedChains: 3, untrackedActiveRuns: 1, availableSlots: 47 }, assessedAt: at,
});
const emptyHistory: ExecutionPolicyHistoryResult = { ok: true, items: [], nextBeforeRevision: null };
const requests: { url: string; method: string; body: string | null; cache: RequestCache | undefined }[] = [];
const snapshotAt = (revision: number) => ExecutionPolicySnapshot.parse({ ...initialSnapshot, policy: { ...initialSnapshot.policy, revision } });
function change(revision: number, requestId = firstRequest, limits = initialSnapshot.policy.limits): ExecutionPolicyChangeView {
  return { id: "00000000-0000-4000-8000-" + String(revision).padStart(12, "0"), requestId, revision,
    previousLimits: initialSnapshot.policy.limits, limits, reason: "已核对实际业务容量", createdAt: at };
}
async function throughRoutes(url: RequestInfo | URL, init?: RequestInit) {
  const target = new URL(String(url), "http://localhost");
  const headers = new Headers(init?.headers);
  headers.set("origin", target.origin);
  const request = new Request(target, { ...init, headers });
  requests.push({ url: target.href, method: request.method, body: request.method === "POST" ? await request.clone().text() : null, cache: init?.cache });
  if (target.pathname.endsWith("/history")) return historyGET(request);
  return request.method === "POST" ? POST(request) : GET(request);
}
function panel(history: ExecutionPolicyHistoryResult = emptyHistory) {
  return <ExecutionResourcesPanel initialRead={{ ok: true, snapshot: initialSnapshot }} initialHistory={history} />;
}
function fill(reason = " 增加试点容量 ") {
  fireEvent.change(screen.getByRole("spinbutton", { name: "同时保留的执行链名额" }), { target: { value: "60" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "每条执行链的模型调用上限" }), { target: { value: "300" } });
  fireEvent.change(screen.getByRole("spinbutton", { name: "每条执行链的协作任务上限" }), { target: { value: "0" } });
  fireEvent.change(screen.getByRole("textbox", { name: "修改原因" }), { target: { value: reason } });
  fireEvent.click(screen.getByRole("checkbox"));
}
function submit() { fireEvent.submit(screen.getByRole("form", { name: "修改资源限额" })); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}
beforeEach(() => {
  requests.length = 0;
  mocks.read.mockReset().mockResolvedValue(initialSnapshot);
  mocks.history.mockReset().mockResolvedValue(emptyHistory);
  mocks.write.mockReset().mockImplementation(async (input: ExecutionPolicyInput) => {
    const policy = { ...initialSnapshot.policy, revision: input.expectedRevision + 1, limits: input.limits };
    mocks.read.mockResolvedValue({ ...initialSnapshot, policy, capacity: { ...initialSnapshot.capacity, availableSlots: input.limits.maxConcurrentChains - 3 } });
    mocks.history.mockResolvedValue({ ok: true, items: [change(policy.revision, input.requestId, input.limits)], nextBeforeRevision: null });
    return { ok: true, recordedRevision: policy.revision, policy };
  });
  vi.stubGlobal("fetch", vi.fn(throughRoutes));
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(firstRequest);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("资源管理组件与真实部署接口组合（数据读写均为mock）", () => {
  it("展示真实快照的来源、三个上限与独立容量口径，不在挂载时提交", () => {
    const { container } = render(panel());
    const summary = within(screen.getByLabelText("本次资源摘要"));
    expect(summary.getByText("已保存的资源设置 · 第 1 版")).toBeInTheDocument();
    expect(summary.getByText(/2026\/10\/09 09:00:00/)).toBeInTheDocument();
    expect(summary.getByText("本次读取的可用名额").nextElementSibling).toHaveTextContent("47");
    expect(summary.getByText("其中未确认完整关联的活跃任务").nextElementSibling).toHaveTextContent("1");
    expect(container.textContent).not.toContain(firstRequest);
    expect(mocks.write).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("默认设置只有成功读取且来源为默认时才展示，不以默认值替代读取失败", () => {
    const defaults = ExecutionPolicySnapshot.parse({ ...initialSnapshot, policy: { ...initialSnapshot.policy, revision: 0, source: "default", updatedAt: null } });
    const { rerender } = render(<ExecutionResourcesPanel initialRead={{ ok: true, snapshot: defaults }} initialHistory={emptyHistory} />);
    expect(screen.getByText("服务端默认设置")).toBeInTheDocument();
    rerender(<ExecutionResourcesPanel initialRead={{ ok: false, error: "读取失败" }} initialHistory={emptyHistory} />);
    expect(screen.queryByText("服务端默认设置")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认并保存资源设置" })).toBeDisabled();
  });

  it("资源读取失败独立保留历史，空字段不能冒充默认设置", () => {
    render(<ExecutionResourcesPanel initialRead={{ ok: false, error: "未知" }} initialHistory={{ ok: true, items: [change(1)], nextBeforeRevision: null }} />);
    expect(screen.getByText(/当前上限与可用名额未知/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "资源设置第 1 版" })).toBeInTheDocument();
    for (const input of screen.getAllByRole("spinbutton")) expect(input).toHaveValue(null);
    expect(screen.queryByText("服务端默认设置")).not.toBeInTheDocument();
    submit();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("历史读取失败独立保留资源摘要，不按空历史显示", () => {
    render(<ExecutionResourcesPanel initialRead={{ ok: true, snapshot: initialSnapshot }} initialHistory={{ ok: false, error: "未知" }} />);
    expect(screen.getByLabelText("本次资源摘要")).toBeInTheDocument();
    expect(screen.getByText(/不能按空记录显示/)).toBeInTheDocument();
    expect(screen.queryByText("本页没有已读取的变更记录。")).not.toBeInTheDocument();
  });

  it.each(["confirmation", "reason", "blank-child", "decimal", "upper-limit"])("缺少确认或非法填写%s不创建保存请求", (kind) => {
    render(panel());
    fill();
    if (kind === "confirmation") fireEvent.click(screen.getByRole("checkbox"));
    if (kind === "reason") fireEvent.change(screen.getByRole("textbox"), { target: { value: " " } });
    if (kind === "blank-child") fireEvent.change(screen.getByRole("spinbutton", { name: "每条执行链的协作任务上限" }), { target: { value: "" } });
    if (kind === "decimal") fireEvent.change(screen.getByRole("spinbutton", { name: "每条执行链的模型调用上限" }), { target: { value: "1.5" } });
    if (kind === "upper-limit") fireEvent.change(screen.getByRole("spinbutton", { name: "同时保留的执行链名额" }), { target: { value: "2001" } });
    submit();
    expect(screen.getByRole("alert")).toHaveTextContent("三个整数上限");
    expect(mocks.write).not.toHaveBeenCalled();
    expect(crypto.randomUUID).not.toHaveBeenCalled();
  });

  it("三个限制、原因、原版本与明确确认实际经POST到唯一Server Action", async () => {
    render(panel());
    fill(); submit();
    await screen.findByText(/这次请求已记录为第 2 版/);
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith({
      requestId: firstRequest, expectedRevision: 1, confirmed: true,
      limits: { maxConcurrentChains: 60, maxModelCalls: 300, maxChildRuns: 0 }, reason: "增加试点容量",
    });
    await waitFor(() => expect(screen.getByText("已保存的资源设置 · 第 2 版")).toBeInTheDocument());
    expect(requests.filter((item) => item.method === "POST")).toHaveLength(1);
    expect(requests.every((item) => item.cache === "no-store")).toBe(true);
    expect(mocks.history).toHaveBeenCalledWith(expect.any(String), { limit: 20 });
    expect(screen.getByRole("checkbox")).toBeDisabled();
  });

  it("不确定结果核对后原请求仍用同一标识和原正文，旧回执不冒充当前设置", async () => {
    mocks.write.mockResolvedValueOnce({ ok: false, retryable: true, error: "资源设置暂时无法确认，请沿用原请求重试" });
    render(panel()); fill(); submit();
    await screen.findByRole("button", { name: "沿用原请求重试" });
    const original = mocks.write.mock.calls[0][0] as ExecutionPolicyInput;
    mocks.read.mockResolvedValue(snapshotAt(4));
    mocks.history.mockResolvedValue({ ok: true, items: [change(2, original.requestId, original.limits)], nextBeforeRevision: null });
    mocks.write.mockResolvedValueOnce({ ok: true, recordedRevision: 2, policy: snapshotAt(4).policy });
    fireEvent.click(screen.getByRole("button", { name: "核对保存结果" }));
    await screen.findByText(/已核对到这次原请求的第 2 版记录/);
    expect(screen.getByRole("spinbutton", { name: "每条执行链的模型调用上限" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "沿用原请求重试" }));
    await screen.findByText(/当前已是第 4 版，这次原请求并未把旧内容重新设为当前值/);
    expect(mocks.write.mock.calls[1][0]).toEqual(original);
    const posts = requests.filter((item) => item.method === "POST");
    expect(posts[1].body).toBe(posts[0].body);
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
    expect(screen.getByText("已保存的资源设置 · 第 4 版")).toBeInTheDocument();
  });

  it("POST已到动作而响应丢失时保留原正文，不把异常当作未保存", async () => {
    const transport = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const response = await throughRoutes(url, init);
      if (init?.method === "POST") throw new TypeError("Response connection lost");
      return response;
    });
    vi.stubGlobal("fetch", transport);
    render(panel()); fill(); submit();
    await screen.findByRole("button", { name: "沿用原请求重试" });
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("结果暂时无法确认");
    expect(screen.queryByText(/保存未发生/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "核对保存结果" }));
    await screen.findByText(/已核对到这次原请求的第 2 版记录/);
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });

  it("冲突保留原版本，必须核对后明确重新填写和确认才创建另一个请求", async () => {
    vi.mocked(crypto.randomUUID).mockReturnValueOnce(firstRequest).mockReturnValueOnce(secondRequest);
    mocks.write.mockResolvedValueOnce({ ok: false, conflict: true, error: "资源设置已被更新，请刷新后再提交" });
    render(panel()); fill(); submit();
    await screen.findByText(/当前请求不能自动改版本/);
    expect(screen.queryByRole("button", { name: "沿用原请求重试" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新确认新的设置" })).toBeDisabled();
    mocks.read.mockResolvedValue(snapshotAt(3));
    fireEvent.click(screen.getByRole("button", { name: "核对保存结果" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "重新确认新的设置" })).toBeEnabled());
    expect(mocks.write).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "重新确认新的设置" }));
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(screen.getByRole("textbox")).toHaveValue("");
    fill("核对新版后调整"); submit();
    await screen.findByText(/这次请求已记录为第 4 版/);
    expect(mocks.write.mock.calls[0][0]).toMatchObject({ requestId: firstRequest, expectedRevision: 1 });
    expect(mocks.write.mock.calls[1][0]).toMatchObject({ requestId: secondRequest, expectedRevision: 3, confirmed: true, reason: "核对新版后调整" });
  });

  it("未找到最近一页的原请求只说明范围有限，核对只读且不自动写入", async () => {
    mocks.write.mockResolvedValueOnce({ ok: false, retryable: true, error: "请沿用原请求" });
    render(panel()); fill(); submit();
    await screen.findByRole("button", { name: "沿用原请求重试" });
    fireEvent.click(screen.getByRole("button", { name: "核对保存结果" }));
    await screen.findByText(/记录可能在更早的历史页/);
    expect(requests.filter((item) => item.method === "POST")).toHaveLength(1);
    expect(screen.queryByText("保存没有发生")).not.toBeInTheDocument();
  });

  it("连续提交期间只发一次，按钮和字段冻结直到回执核对", async () => {
    const pending = deferred<ExecutionPolicyWriteResult>();
    mocks.write.mockReturnValueOnce(pending.promise);
    render(panel()); fill(); submit(); submit();
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "核对保存结果" })).toBeDisabled();
    const savedPolicy = { ...snapshotAt(2).policy, limits: (mocks.write.mock.calls[0][0] as ExecutionPolicyInput).limits };
    mocks.read.mockResolvedValue({ ...initialSnapshot, policy: savedPolicy, capacity: { ...initialSnapshot.capacity, availableSlots: savedPolicy.limits.maxConcurrentChains - 3 } });
    await act(async () => pending.resolve({ ok: true, recordedRevision: 2, policy: savedPolicy }));
    await screen.findByText(/这次请求已记录为第 2 版/);
    expect(requests.filter((item) => item.method === "POST")).toHaveLength(1);
  });

  it("组件刷新保留冻结请求，整页重挂载丢失正文时不会提供原请求重试", async () => {
    mocks.write.mockResolvedValue({ ok: false, retryable: true, error: "请沿用原请求" });
    const view = render(panel()); fill(); submit();
    await screen.findByRole("button", { name: "沿用原请求重试" });
    const original = mocks.write.mock.calls[0][0];
    view.rerender(<ExecutionResourcesPanel initialRead={{ ok: true, snapshot: snapshotAt(4) }} initialHistory={emptyHistory} />);
    fireEvent.click(screen.getByRole("button", { name: "沿用原请求重试" }));
    await waitFor(() => expect(mocks.write).toHaveBeenCalledTimes(2));
    expect(mocks.write.mock.calls[1][0]).toEqual(original);
    view.unmount();
    render(panel());
    expect(screen.queryByRole("button", { name: "沿用原请求重试" })).not.toBeInTheDocument();
    expect(screen.getByText(/如丢失原内容，本页不会提供原请求重试/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(mocks.write).toHaveBeenCalledTimes(2);
  });

  it("真实历史游标传到查询，较新返回和失败重读保留确切范围", async () => {
    const recent: ExecutionPolicyHistoryResult = { ok: true, items: [change(5), change(4)], nextBeforeRevision: 4 };
    render(panel(recent));
    mocks.history.mockRejectedValueOnce(new Error("postgres://user:private-value@db.example"));
    fireEvent.click(screen.getByRole("button", { name: "读取更早的记录" }));
    await screen.findByText(/不能按空记录显示/);
    expect(mocks.history).toHaveBeenLastCalledWith(expect.any(String), { limit: 20, beforeRevision: 4 });
    expect(screen.queryByText(/private-value/)).not.toBeInTheDocument();
    mocks.history.mockResolvedValueOnce({ ok: true, items: [change(3)], nextBeforeRevision: null });
    fireEvent.click(screen.getByRole("button", { name: "重新读取此页历史" }));
    await screen.findByRole("heading", { name: "资源设置第 3 版" });
    expect(mocks.history).toHaveBeenLastCalledWith(expect.any(String), { limit: 20, beforeRevision: 4 });
    mocks.history.mockResolvedValueOnce(recent);
    fireEvent.click(screen.getByRole("button", { name: "返回较新一页" }));
    await screen.findByRole("heading", { name: "资源设置第 5 版" });
    expect(mocks.history).toHaveBeenLastCalledWith(expect.any(String), { limit: 20 });
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it("历史响应超出请求游标范围时拒绝替代内容", async () => {
    render(panel({ ok: true, items: [change(4)], nextBeforeRevision: 4 }));
    mocks.history.mockResolvedValueOnce({ ok: true, items: [change(5)], nextBeforeRevision: null });
    fireEvent.click(screen.getByRole("button", { name: "读取更早的记录" }));
    await screen.findByText(/不能按空记录显示/);
    expect(screen.queryByRole("heading", { name: "资源设置第 5 版" })).not.toBeInTheDocument();
  });

  it("错误保存回执由真实路由转成不确定，不能显示已保存", async () => {
    mocks.write.mockResolvedValueOnce({ ok: true, recordedRevision: 3, policy: snapshotAt(3).policy });
    render(panel()); fill(); submit();
    await screen.findByRole("button", { name: "沿用原请求重试" });
    expect(screen.queryByText(/这次请求已记录/)).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeDisabled();
  });

  it("资源重新读取失败会撤下旧读数，不声称仍有47个当前名额", async () => {
    render(panel());
    mocks.read.mockRejectedValueOnce(new Error("private-database-error"));
    fireEvent.click(screen.getByRole("button", { name: "重新读取资源摘要" }));
    await screen.findByText(/当前上限与可用名额未知/);
    expect(screen.queryByLabelText("本次资源摘要")).not.toBeInTheDocument();
    expect(screen.queryByText(/private-database-error/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认并保存资源设置" })).toBeDisabled();
  });
});
