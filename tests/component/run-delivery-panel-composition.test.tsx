import { StrictMode } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunDeliveryResult, RunDeliveryRetryBody, RunDeliveryRetryResult, RunDeliveryView } from "@/contracts/run-delivery";
import { RunView } from "@/contracts/run";
import { RunDeliveryPanel } from "@/features/runs/RunDeliveryPanel";
import { RunDetail } from "@/features/runs/RunDetail";
import { BusinessResultExportButtons } from "@/features/runs/BusinessResultExportButtons";

const io = vi.hoisted(() => ({ run: vi.fn(), steps: vi.fn(), approvals: vi.fn(), trace: vi.fn(), wait: vi.fn(), children: vi.fn(), feedback: vi.fn(), refresh: vi.fn() }));
vi.mock("@/server/queries/runs", () => ({ getRunView: io.run, listRunSteps: io.steps, listApprovals: io.approvals, getPendingWait: io.wait, listChildRuns: io.children }));
vi.mock("@/server/queries/trace", () => ({ listRecentTrace: io.trace }));
vi.mock("@/server/queries/run-feedback", () => ({ getRunFeedback: io.feedback }));
vi.mock("@/features/runs/model-usage-client", () => ({
  readRunModelUsage: () => Promise.reject(new Error("统计读取不可用")),
  readRunModelUsageChain: () => Promise.reject(new Error("统计读取不可用")),
}));
vi.mock("@/server/actions/run-feedback", () => ({ saveRunFeedbackAction: vi.fn(), createRegressionCaseFromRunFeedbackAction: vi.fn() }));
vi.mock("@/server/actions/cancel-run", () => ({ cancelRunAction: vi.fn() }));
vi.mock("@/server/actions/retry-run", () => ({ retryRunAction: vi.fn() }));
vi.mock("@/server/actions/resume-run-start", () => ({ resumeRunStartAction: vi.fn() }));
vi.mock("@/server/actions/decide-approval", () => ({ decideApprovalAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: io.refresh, push: vi.fn() }), notFound: () => { throw new Error("未找到运行"); } }));

const A = "20000000-0000-4000-8000-000000000001";
const B = "20000000-0000-4000-8000-000000000002";
const DELIVERY = "20000000-0000-4000-8000-000000000003";
const OTHER_DELIVERY = "20000000-0000-4000-8000-000000000004";
const REQUEST = "20000000-0000-4000-8000-000000000005";
const NEXT_REQUEST = "20000000-0000-4000-8000-000000000006";
const USER = "20000000-0000-4000-8000-000000000007";
const BEFORE = "2026-10-10T00:00:00.000Z";
const AFTER = "2026-10-10T00:05:00.000Z";
const reason = "已于今天核对接收方业务记录，未找到这份成果，请核对补投条件。";
const request = vi.fn<typeof fetch>();
const run = RunView.parse({ id: A, agentId: B, agentName: "业务成果核对助手", status: "completed", input: { task: "核对公司资料" }, result: { 正文: "本次已保存的业务成果" }, error: null, startedAt: BEFORE, finishedAt: AFTER });

function delivery(status: RunDeliveryView["status"] = "failed", overrides: Partial<RunDeliveryView> = {}) {
  return RunDeliveryView.parse({
    id: DELIVERY, runId: A, targetId: "private.receiver", status, attempts: 5, maxAttempts: 5,
    error: status === "failed" ? "接收方未返回本次投递的有效确认回执，请人工核对 private-secret" : null,
    receipt: status === "delivered" ? { ok: true, deliveryId: DELIVERY, receiptId: "private.receipt" } : null,
    nextAttemptAt: null, retryDeadline: "2027-10-10T00:00:00.000Z", deliveredAt: status === "delivered" ? AFTER : null,
    createdAt: BEFORE, updatedAt: BEFORE, resolutions: [], ...overrides,
  });
}
function readResponse(value: RunDeliveryView | null = delivery(), runId = A) {
  return Response.json(RunDeliveryResult.parse({ ok: true, runId, delivery: value }));
}
function recorded(runId = A, deliveryId = DELIVERY) {
  return Response.json(RunDeliveryRetryResult.parse({ ok: true, runId, deliveryId, recorded: true }));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
function exportIo() {
  const NativeURL = URL;
  const create = vi.fn<(object: Blob | MediaSource) => string>().mockReturnValueOnce("blob:delivery-first").mockReturnValue("blob:delivery-next");
  const revoke = vi.fn<(url: string) => void>();
  vi.stubGlobal("URL", class extends NativeURL { static createObjectURL = create; static revokeObjectURL = revoke; });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  return { create, revoke, click };
}
function panel() { return screen.getByRole("region", { name: "接收状态与人工补投" }); }
function posts() { return request.mock.calls.filter(([, options]) => options?.method === "POST"); }
async function prepare(user: ReturnType<typeof userEvent.setup>) {
  await within(panel()).findByRole("heading", { name: "发送已停止，需人工核对" });
  await user.type(within(panel()).getByRole("textbox", { name: "补投核对原因" }), reason);
  await user.click(within(panel()).getByRole("button", { name: "核对并申请补投" }));
  await screen.findByRole("dialog", { name: "确认申请补投？" });
}

beforeEach(() => {
  request.mockReset().mockResolvedValue(readResponse());
  vi.stubGlobal("fetch", request);
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(REQUEST);
  io.run.mockReset().mockResolvedValue(run);
  for (const value of [io.steps, io.approvals, io.trace, io.children]) value.mockReset().mockResolvedValue([]);
  io.wait.mockReset().mockResolvedValue(null);
  io.feedback.mockReset().mockResolvedValue(null);
  io.refresh.mockReset();
});
afterEach(() => {
  for (const [url, options] of request.mock.calls) {
    expect(url).toMatch(/^\/api\/runs\/[0-9a-f-]{36}\/delivery$/);
    expect(options).toMatchObject({ cache: "no-store", credentials: "same-origin", redirect: "error" });
    expect(["GET", "POST"]).toContain(options?.method);
  }
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("实际运行详情的成果投递面板", () => {
  it("首次真实只读加载在卸载时中止，迟到响应体不能进入新挂载的同任务会话", async () => {
    const body = deferred<unknown>();
    const json = vi.fn(() => body.promise);
    request.mockResolvedValueOnce({ ok: true, status: 200, json } as unknown as Response).mockResolvedValueOnce(readResponse(null));
    const old = render(<RunDeliveryPanel runId={A} />);
    expect(within(panel()).getByText("正在读取已保存的投递记录…")).toBeInTheDocument();
    expect(within(panel()).getByRole("button", { name: "重新读取投递状态" })).toBeDisabled();
    await waitFor(() => expect(json).toHaveBeenCalledOnce());
    expect(request).toHaveBeenCalledOnce();
    const signal = request.mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    old.unmount();
    expect(signal?.aborted).toBe(true);
    render(<RunDeliveryPanel runId={A} />);
    await within(panel()).findByText(/尚无已保存的投递记录/);
    await act(async () => { body.resolve(RunDeliveryResult.parse({ ok: true, runId: A, delivery: delivery("delivered") })); await body.promise; });
    expect(within(panel()).queryByRole("heading", { name: "接收方已确认" })).not.toBeInTheDocument();
    expect(within(panel()).queryByRole("textbox")).not.toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(2); expect(posts()).toHaveLength(0);
  });

  it("导出来源变化清除旧反馈、回收旧下载地址，同来源重绘保留反馈与触发焦点", () => {
    vi.useFakeTimers();
    try {
      const downloads = exportIo();
      const view = render(<BusinessResultExportButtons markdown="原成果正文" csv="原成果清单" />);
      const trigger = screen.getByRole("button", { name: "导出业务成果文档" });
      trigger.focus();
      fireEvent.click(trigger);
      expect(screen.getByText(/已发起下载，请查看浏览器下载记录/)).toBeInTheDocument();
      expect(trigger).toHaveFocus();
      view.rerender(<BusinessResultExportButtons markdown="原成果正文" csv="原成果清单" />);
      expect(screen.getByText(/已发起下载，请查看浏览器下载记录/)).toBeInTheDocument();
      expect(downloads.revoke).not.toHaveBeenCalled();
      view.rerender(<BusinessResultExportButtons markdown="新成果正文" csv="新成果清单" />);
      expect(screen.queryByText(/已发起下载，请查看浏览器下载记录/)).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(downloads.revoke).toHaveBeenCalledExactlyOnceWith("blob:delivery-first");
      expect(screen.getByRole("button", { name: "导出业务成果文档" })).toBe(trigger); expect(trigger).toHaveFocus();
      fireEvent.click(screen.getByRole("button", { name: "导出交付内容清单" }));
      expect(downloads.create).toHaveBeenCalledTimes(2); expect(downloads.click).toHaveBeenCalledTimes(2);
      expect(screen.getByText(/本页不能确认文件是否已保存/)).toBeInTheDocument();
      view.unmount();
      expect(downloads.revoke.mock.calls).toEqual([["blob:delivery-first"], ["blob:delivery-next"]]);
      act(() => { vi.advanceTimersByTime(1000); });
      expect(downloads.revoke).toHaveBeenCalledTimes(2); expect(request).not.toHaveBeenCalled();
    } finally { cleanup(); vi.useRealTimers(); }
  });

  it("下载原生点击期间成果换源，旧操作不登记新来源反馈，地址仍只回收一次", () => {
    vi.useFakeTimers();
    try {
      const downloads = exportIo();
      const view = render(<BusinessResultExportButtons markdown="原成果正文" csv="原成果清单" />);
      downloads.click.mockImplementationOnce(() => flushSync(() => view.rerender(<BusinessResultExportButtons markdown="新成果正文" csv="新成果清单" />)));
      fireEvent.click(screen.getByRole("button", { name: "导出业务成果文档" }));
      expect(screen.queryByText(/已发起下载，请查看浏览器下载记录/)).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(downloads.revoke).toHaveBeenCalledExactlyOnceWith("blob:delivery-first");
      fireEvent.click(screen.getByRole("button", { name: "导出交付内容清单" }));
      expect(screen.getByText(/已发起下载，请查看浏览器下载记录/)).toBeInTheDocument();
      view.unmount();
      act(() => { vi.advanceTimersByTime(1000); });
      expect(downloads.revoke.mock.calls).toEqual([["blob:delivery-first"], ["blob:delivery-next"]]);
      expect(downloads.create).toHaveBeenCalledTimes(2); expect(request).not.toHaveBeenCalled();
    } finally { cleanup(); vi.useRealTimers(); }
  });

  it("真实父页面挂载导航和叶子；投递读取失败不破坏已保存结果及其他证据", async () => {
    request.mockRejectedValue(new Error("DATABASE_URL private-secret"));
    const user = userEvent.setup();
    render(await RunDetail({ runId: A }));
    expect(screen.getByRole("navigation", { name: "运行详情区块" }).querySelector('a[href="#delivery"]')).toHaveTextContent("成果投递");
    expect(screen.getByText("本次已保存的业务成果")).toBeInTheDocument();
    await within(panel()).findByText("投递状态暂时无法核对");
    expect(within(panel()).queryByText(/尚无已保存/)).not.toBeInTheDocument();
    expect(within(panel()).queryByRole("textbox")).not.toBeInTheDocument();
    await user.click(within(panel()).getByRole("button", { name: "重新读取投递状态" }));
    await within(panel()).findByText("投递状态暂时无法核对");
    expect(posts()).toHaveLength(0);
    expect(io.refresh).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/DATABASE_URL|private-secret/);
  });

  it("加载期间无数量和写操作；成功空记录不声称未配置", async () => {
    const read = deferred<Response>();
    request.mockReturnValueOnce(read.promise);
    render(<RunDeliveryPanel runId={A} />);
    expect(within(panel()).getByText("正在读取已保存的投递记录…")).toBeInTheDocument();
    expect(within(panel()).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(panel()).getByRole("button")).toBeDisabled();
    read.resolve(readResponse(null));
    await within(panel()).findByText(/尚无已保存的投递记录/);
    expect(panel()).toHaveTextContent("不能据此判断是否配置了接收方");
    expect(panel()).not.toHaveTextContent("未配置接收方");
    expect(posts()).toHaveLength(0);
  });

  it.each([
    ["waiting_result", "等待成果"], ["pending", "等待安排发送"], ["queued", "已安排发送，等待执行"],
    ["sending", "正在发送"], ["delivered", "接收方已确认"], ["failed", "发送已停止，需人工核对"],
  ] as const)("只展示真实%s状态、实际次数和时间，内部标识不进入业务界面", async (status, label) => {
    request.mockResolvedValue(readResponse(delivery(status)));
    render(<RunDeliveryPanel runId={A} />);
    await within(panel()).findByRole("heading", { name: label });
    expect(panel()).toHaveTextContent("5／5 次");
    expect(panel()).toHaveTextContent("最后更新");
    expect(panel()).toHaveTextContent("北京时间");
    expect(panel()).toHaveTextContent("接收方防重有效期");
    expect(within(panel()).queryByRole("textbox", { name: "补投核对原因" }) !== null).toBe(status === "failed");
    for (const value of [A, DELIVERY, "private.receiver", "private.receipt", "private-secret"]) expect(panel().textContent).not.toContain(value);
    expect(posts()).toHaveLength(0);
  });

  it.each([
    () => Response.json({ ok: true, runId: A, delivery: { status: "delivered" } }),
    () => readResponse(delivery("failed", { runId: B }), B),
    () => Response.json({ ok: false, error: "private-secret" }, { status: 503 }),
    () => new Response("不是有效JSON"),
  ])("非法、错归属和失败读取均未知，不提供假空记录或失败写表单", async (response) => {
    request.mockResolvedValue(response());
    render(<RunDeliveryPanel runId={A} />);
    await within(panel()).findByText("投递状态暂时无法核对");
    expect(within(panel()).queryByRole("textbox")).not.toBeInTheDocument();
    expect(panel()).not.toHaveTextContent("private-secret");
    expect(posts()).toHaveLength(0);
  });

  it("确认前没有POST；确认同批双击只发送一次，成功只声称已登记并锁住重复补投", async () => {
    const user = userEvent.setup();
    const send = deferred<Response>();
    request.mockResolvedValueOnce(readResponse()).mockReturnValueOnce(send.promise).mockResolvedValue(readResponse());
    render(<RunDeliveryPanel runId={A} />);
    await prepare(user);
    expect(posts()).toHaveLength(0);
    const button = screen.getByRole("button", { name: "确认申请补投" });
    act(() => { button.click(); button.click(); });
    expect(posts()).toHaveLength(1);
    expect(RunDeliveryRetryBody.parse(JSON.parse(String(posts()[0][1]?.body)))).toEqual({ requestId: REQUEST, confirmed: true, reason });
    expect(within(panel()).getByRole("textbox", { name: "本次固定的补投原因" })).toHaveAttribute("readonly");
    expect(within(panel()).getByRole("button", { name: "重新读取投递状态" })).toBeDisabled();
    send.resolve(recorded());
    await within(panel()).findByText(/补投请求已记录；请重新读取投递状态/);
    expect(within(panel()).queryByRole("button", { name: "核对并申请补投" })).not.toBeInTheDocument();
    expect(within(panel()).queryByRole("button", { name: "按原请求核对补投" })).not.toBeInTheDocument();
    expect(panel()).toHaveTextContent("不代表当前发送或接收状态");
    await user.click(within(panel()).getByRole("button", { name: "重新读取投递状态" }));
    await within(panel()).findByRole("heading", { name: "发送已停止，需人工核对" });
    expect(within(panel()).queryByRole("button", { name: "针对新读取的失败记录重新申请" })).not.toBeInTheDocument();
    expect(posts()).toHaveLength(1);
  });

  it.each([
    () => Promise.reject(new Error("private-secret")),
    () => Promise.resolve(Response.json({ ok: false, error: "private-secret", retryable: true }, { status: 503 })),
    () => Promise.resolve(new Response("not-json")),
    () => Promise.resolve(Response.json({ ok: true, runId: A, deliveryId: DELIVERY })),
    () => Promise.resolve(recorded(B)),
    () => Promise.resolve(recorded(A, OTHER_DELIVERY)),
  ])("请求失败或不一致回执锁住原原因；新failed读取不解锁，人工核对使用相同完整原请求", async (failure) => {
    const user = userEvent.setup();
    request.mockResolvedValueOnce(readResponse()).mockImplementationOnce(failure).mockResolvedValueOnce(readResponse()).mockResolvedValueOnce(recorded());
    render(<RunDeliveryPanel runId={A} />);
    await prepare(user);
    await user.click(screen.getByRole("button", { name: "确认申请补投" }));
    await within(panel()).findByText(/补投结果尚无法确认/);
    const fixed = within(panel()).getByRole("textbox", { name: "本次固定的补投原因" });
    expect(fixed).toHaveValue(reason); expect(fixed).toHaveAttribute("readonly");
    expect(within(panel()).getByRole("button", { name: "按原请求核对补投" })).toBeDisabled();
    expect(within(panel()).queryByRole("button", { name: "核对并申请补投" })).not.toBeInTheDocument();
    await user.click(within(panel()).getByRole("button", { name: "重新读取投递状态" }));
    await waitFor(() => expect(within(panel()).getByRole("button", { name: "按原请求核对补投" })).toBeEnabled());
    expect(fixed).toHaveValue(reason); expect(fixed).toHaveAttribute("readonly");
    expect(posts()).toHaveLength(1);
    await user.click(within(panel()).getByRole("button", { name: "按原请求核对补投" }));
    expect(posts()).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "确认按原请求核对" }));
    await within(panel()).findByText(/补投请求已记录；请重新读取投递状态/);
    expect(posts()).toHaveLength(2);
    expect(posts()[1][1]?.body).toBe(posts()[0][1]?.body);
    expect(panel()).not.toHaveTextContent("private-secret");
  });

  it("未知请求遇到错投递归属、无记录或读取失败不允许按新请求核对", async () => {
    const user = userEvent.setup();
    request.mockResolvedValueOnce(readResponse()).mockRejectedValueOnce(new Error("请求中断"))
      .mockResolvedValueOnce(readResponse(delivery("failed", { id: OTHER_DELIVERY })))
      .mockResolvedValueOnce(readResponse(null)).mockRejectedValueOnce(new Error("读取失败"));
    render(<RunDeliveryPanel runId={A} />);
    await prepare(user); await user.click(screen.getByRole("button", { name: "确认申请补投" }));
    await within(panel()).findByText(/补投结果尚无法确认/);
    for (let index = 0; index < 3; index++) {
      await user.click(within(panel()).getByRole("button", { name: "重新读取投递状态" }));
      await waitFor(() => expect(within(panel()).getByRole("button", { name: "重新读取投递状态" })).toBeEnabled());
      expect(within(panel()).getByRole("button", { name: "按原请求核对补投" })).toBeDisabled();
      expect(within(panel()).getByRole("textbox", { name: "本次固定的补投原因" })).toHaveValue(reason);
    }
    expect(posts()).toHaveLength(1);
  });

  it("原请求未知后的明确409仍未知；新GET不能解锁，之后仍按同请求核对直到正回执", async () => {
    const user = userEvent.setup();
    request.mockResolvedValueOnce(readResponse()).mockRejectedValueOnce(new Error("上次请求中断"))
      .mockResolvedValueOnce(readResponse()).mockResolvedValueOnce(Response.json({ ok: false, error: "接收方配置已变化，请先人工核对" }, { status: 409 }))
      .mockResolvedValueOnce(readResponse(delivery("failed", { updatedAt: AFTER }))).mockResolvedValueOnce(recorded());
    render(<RunDeliveryPanel runId={A} />);
    await prepare(user); await user.click(screen.getByRole("button", { name: "确认申请补投" }));
    await within(panel()).findByText(/补投结果尚无法确认/);
    for (let index = 0; index < 2; index++) {
      await user.click(within(panel()).getByRole("button", { name: "重新读取投递状态" }));
      await waitFor(() => expect(within(panel()).getByRole("button", { name: "按原请求核对补投" })).toBeEnabled());
      expect(within(panel()).queryByRole("button", { name: "重新填写补投原因" })).not.toBeInTheDocument();
      expect(within(panel()).queryByRole("button", { name: "针对新读取的失败记录重新申请" })).not.toBeInTheDocument();
      await user.click(within(panel()).getByRole("button", { name: "按原请求核对补投" }));
      await user.click(screen.getByRole("button", { name: "确认按原请求核对" }));
      if (index === 0) {
        await within(panel()).findByText(/本次核对未获准/);
        expect(within(panel()).getByRole("textbox", { name: "本次固定的补投原因" })).toHaveAttribute("readonly");
        expect(within(panel()).getByRole("button", { name: "按原请求核对补投" })).toBeDisabled();
      }
    }
    await within(panel()).findByText(/补投请求已记录；请重新读取投递状态/);
    expect(posts()).toHaveLength(3);
    expect(posts().map(([, options]) => options?.body)).toEqual(Array(3).fill(posts()[0][1]?.body));
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  it("已有登记回执后，仅新的真实失败快照及匹配人工记录允许另一次确认", async () => {
    const user = userEvent.setup();
    request.mockResolvedValueOnce(readResponse()).mockResolvedValueOnce(recorded()).mockResolvedValueOnce(readResponse(delivery("failed", {
      updatedAt: AFTER, resolutions: [{ requestId: REQUEST, requestHash: "a".repeat(64), reason, createdBy: USER, createdAt: AFTER }],
    }))).mockResolvedValueOnce(recorded());
    render(<RunDeliveryPanel runId={A} />);
    await prepare(user); await user.click(screen.getByRole("button", { name: "确认申请补投" }));
    await within(panel()).findByText(/补投请求已记录；请重新读取投递状态/);
    await user.click(within(panel()).getByRole("button", { name: "重新读取投递状态" }));
    await user.click(await within(panel()).findByRole("button", { name: "针对新读取的失败记录重新申请" }));
    vi.mocked(globalThis.crypto.randomUUID).mockReturnValueOnce(NEXT_REQUEST);
    await prepare(user); await user.click(screen.getByRole("button", { name: "确认申请补投" }));
    await within(panel()).findByText(/补投请求已记录；请重新读取投递状态/);
    expect(JSON.parse(String(posts()[1][1]?.body)).requestId).toBe(NEXT_REQUEST);
    expect(panel().textContent).not.toContain(USER); expect(panel().textContent).not.toContain("a".repeat(64));
  });

  it("未知请求读取到已接收快照后，幂等正回执只确认请求记录，不改已接收状态或声称等待发送", async () => {
    const user = userEvent.setup();
    request.mockResolvedValueOnce(readResponse()).mockRejectedValueOnce(new Error("响应中断"))
      .mockResolvedValueOnce(readResponse(delivery("delivered"))).mockResolvedValueOnce(recorded());
    render(<RunDeliveryPanel runId={A} />);
    await prepare(user); await user.click(screen.getByRole("button", { name: "确认申请补投" }));
    await within(panel()).findByText(/补投结果尚无法确认/);
    await user.click(within(panel()).getByRole("button", { name: "重新读取投递状态" }));
    await within(panel()).findByRole("heading", { name: "接收方已确认" });
    await user.click(within(panel()).getByRole("button", { name: "按原请求核对补投" }));
    await user.click(screen.getByRole("button", { name: "确认按原请求核对" }));
    await within(panel()).findByText(/补投请求已记录；请重新读取投递状态/);
    expect(within(panel()).getByRole("heading", { name: "接收方已确认" })).toBeInTheDocument();
    expect(panel()).not.toHaveTextContent("等待发送");
    expect(panel()).toHaveTextContent("不代表当前发送或接收状态");
    expect(posts()[1][1]?.body).toBe(posts()[0][1]?.body);
  });

  it("合法大写任务标识统一规范化GET、POST与正回执归属", async () => {
    const user = userEvent.setup();
    const canonical = "20000000-0000-4000-8000-abcdef000001";
    request.mockResolvedValueOnce(readResponse(delivery("failed", { runId: canonical }), canonical)).mockResolvedValueOnce(recorded(canonical));
    render(<RunDeliveryPanel runId={canonical.toUpperCase()} />);
    await prepare(user); await user.click(screen.getByRole("button", { name: "确认申请补投" }));
    await within(panel()).findByText(/补投请求已记录；请重新读取投递状态/);
    expect(request.mock.calls.every(([url]) => url === '/api/runs/' + canonical + '/delivery')).toBe(true);
  });

  it("同一任务大小写切换不重挂丢失原未知请求，错任务正回执仍未知", async () => {
    const user = userEvent.setup();
    const canonical = "20000000-0000-4000-8000-abcdef000001";
    request.mockResolvedValueOnce(readResponse(delivery("failed", { runId: canonical }), canonical)).mockRejectedValueOnce(new Error("响应中断"))
      .mockResolvedValueOnce(readResponse(delivery("failed", { runId: canonical }), canonical)).mockResolvedValueOnce(recorded(A));
    const view = render(<RunDeliveryPanel runId={canonical} />);
    await prepare(user); await user.click(screen.getByRole("button", { name: "确认申请补投" }));
    await within(panel()).findByText(/补投结果尚无法确认/);
    view.rerender(<RunDeliveryPanel runId={canonical.toUpperCase()} />);
    expect(request).toHaveBeenCalledTimes(2);
    expect(within(panel()).getByRole("textbox", { name: "本次固定的补投原因" })).toHaveValue(reason);
    await user.click(within(panel()).getByRole("button", { name: "重新读取投递状态" }));
    await waitFor(() => expect(within(panel()).getByRole("button", { name: "按原请求核对补投" })).toBeEnabled());
    await user.click(within(panel()).getByRole("button", { name: "按原请求核对补投" }));
    await user.click(screen.getByRole("button", { name: "确认按原请求核对" }));
    await within(panel()).findByText(/补投结果尚无法确认/);
    expect(posts()[1][1]?.body).toBe(posts()[0][1]?.body);
    expect(within(panel()).queryByText(/补投请求已记录；/)).not.toBeInTheDocument();
  });

  it("无效任务标识不可读取或提交", async () => {
    render(<RunDeliveryPanel runId="invalid-private-task" />);
    await within(panel()).findByText("投递状态暂时无法核对");
    expect(request).not.toHaveBeenCalled();
    expect(panel()).not.toHaveTextContent("invalid-private-task");
  });

  it("明确4xx拒绝保留安全中文，不自动重试；修改原因需人工操作", async () => {
    const user = userEvent.setup();
    request.mockResolvedValueOnce(readResponse()).mockResolvedValueOnce(Response.json({ ok: false, error: "接收方配置已变化，请先人工核对 private-secret" }, { status: 409 }));
    render(<RunDeliveryPanel runId={A} />);
    await prepare(user); await user.click(screen.getByRole("button", { name: "确认申请补投" }));
    await within(panel()).findByText(/本次补投未获准/);
    expect(panel()).toHaveTextContent("接收方配置已变化");
    expect(panel()).not.toHaveTextContent("private-secret");
    expect(posts()).toHaveLength(1);
    await user.click(within(panel()).getByRole("button", { name: "重新填写补投原因" }));
    expect(within(panel()).getByRole("textbox", { name: "补投核对原因" })).toHaveValue("");
  });

  it.each(["recorded", "rejected"] as const)("读取刷新同批点击旧%s编辑按钮不能清除原请求", async (phase) => {
    const user = userEvent.setup();
    const next = deferred<Response>();
    const failedAgain = readResponse(delivery("failed", {
      updatedAt: AFTER, resolutions: [{ requestId: REQUEST, requestHash: "a".repeat(64), reason, createdBy: USER, createdAt: AFTER }],
    }));
    request.mockResolvedValueOnce(readResponse())
      .mockResolvedValueOnce(phase === "recorded" ? recorded() : Response.json({ ok: false, error: "配置无法核对" }, { status: 409 }))
      .mockResolvedValueOnce(failedAgain).mockReturnValueOnce(next.promise);
    render(<RunDeliveryPanel runId={A} />);
    await prepare(user); await user.click(screen.getByRole("button", { name: "确认申请补投" }));
    await within(panel()).findByText(phase === "recorded" ? /补投请求已记录/ : /本次补投未获准/);
    await user.click(within(panel()).getByRole("button", { name: "重新读取投递状态" }));
    const stale = await within(panel()).findByRole("button", { name: phase === "recorded" ? "针对新读取的失败记录重新申请" : "重新填写补投原因" });
    const refresh = within(panel()).getByRole("button", { name: "重新读取投递状态" });
    act(() => { refresh.click(); stale.click(); });
    expect(within(panel()).getByRole("textbox", { name: "本次固定的补投原因" })).toHaveValue(reason);
    expect(within(panel()).queryByRole("textbox", { name: "补投核对原因" })).not.toBeInTheDocument();
    next.resolve(readResponse(null));
    await within(panel()).findByText(/尚无已保存的投递记录/);
    expect(within(panel()).getByRole("textbox", { name: "本次固定的补投原因" })).toHaveValue(reason);
    expect(posts()).toHaveLength(1);
  });

  it("A到B到A、卸载及旧响应体晚返回不会接受旧读取或提交回执", async () => {
    const user = userEvent.setup();
    const body = deferred<unknown>();
    request.mockResolvedValueOnce(readResponse()).mockResolvedValueOnce({ ok: true, status: 200, json: () => body.promise } as Response)
      .mockResolvedValueOnce(readResponse(null, B)).mockResolvedValueOnce(readResponse());
    const view = render(<RunDeliveryPanel runId={A} />);
    await prepare(user); await user.click(screen.getByRole("button", { name: "确认申请补投" }));
    view.rerender(<RunDeliveryPanel runId={B} />);
    await within(panel()).findByText(/尚无已保存的投递记录/);
    view.rerender(<RunDeliveryPanel runId={A} />);
    await within(panel()).findByRole("heading", { name: "发送已停止，需人工核对" });
    body.resolve({ ok: true, runId: A, deliveryId: DELIVERY, recorded: true });
    await act(async () => { await body.promise; });
    expect(within(panel()).queryByText(/补投请求已记录；请重新读取投递状态/)).not.toBeInTheDocument();
    expect(within(panel()).getByRole("textbox", { name: "补投核对原因" })).toHaveValue("");
    expect(posts()).toHaveLength(1);
  });

  it("StrictMode清理中止旧GET，晚读取不覆盖当前快照；重新读取同批只发一次", async () => {
    const user = userEvent.setup();
    const old = deferred<Response>();
    request.mockReturnValueOnce(old.promise).mockResolvedValueOnce(readResponse(null)).mockResolvedValueOnce(readResponse());
    render(<StrictMode><RunDeliveryPanel runId={A} /></StrictMode>);
    await within(panel()).findByText(/尚无已保存的投递记录/);
    expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
    old.resolve(readResponse(delivery("delivered")));
    await act(async () => { await old.promise; });
    expect(within(panel()).queryByRole("heading", { name: "接收方已确认" })).not.toBeInTheDocument();
    const button = within(panel()).getByRole("button", { name: "重新读取投递状态" });
    act(() => { button.click(); button.click(); });
    await within(panel()).findByRole("heading", { name: "发送已停止，需人工核对" });
    expect(request).toHaveBeenCalledTimes(3); expect(posts()).toHaveLength(0);
    await user.click(within(panel()).getByRole("button", { name: "核对并申请补投" }));
    expect(within(panel()).getByRole("alert")).toHaveTextContent("请填写补投核对原因");
  });

  it("未知状态提示离开风险，可拒绝普通导航并阻止卸载；不声称取消服务端", async () => {
    const user = userEvent.setup();
    request.mockResolvedValueOnce(readResponse()).mockRejectedValueOnce(new Error("网络中断"));
    render(<><Link href="/runs" prefetch={false}>返回记录列表</Link><RunDeliveryPanel runId={A} /></>);
    await prepare(user); await user.click(screen.getByRole("button", { name: "确认申请补投" }));
    await within(panel()).findByText(/补投结果尚无法确认/);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    screen.getByRole("link", { name: "返回记录列表" }).dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true); expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("不能取消后台发送"));
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload); expect(unload.defaultPrevented).toBe(true);
    expect(panel()).toHaveTextContent("浏览器返回等离开方式不一定能拦截");
    expect(posts()).toHaveLength(1);
  });

  it("重新读取会关闭准备中的确认，同批晚点击旧确认不会提交", async () => {
    const user = userEvent.setup();
    const next = deferred<Response>();
    request.mockResolvedValueOnce(readResponse()).mockReturnValueOnce(next.promise);
    render(<RunDeliveryPanel runId={A} />);
    const refresh = within(panel()).getByRole("button", { name: "重新读取投递状态" });
    await prepare(user);
    const stale = screen.getByRole("button", { name: "确认申请补投" });
    act(() => { refresh.click(); stale.click(); });
    expect(posts()).toHaveLength(0);
    expect(screen.queryByRole("dialog", { name: "确认申请补投？" })).not.toBeInTheDocument();
    next.resolve(readResponse(null));
    await within(panel()).findByText(/尚无已保存的投递记录/);
    expect(posts()).toHaveLength(0);
  });

  it("取消确认不提交；无效或过长原因不能提交", async () => {
    const user = userEvent.setup();
    render(<RunDeliveryPanel runId={A} />);
    await prepare(user);
    await user.click(screen.getByRole("button", { name: "返回" }));
    expect(posts()).toHaveLength(0);
    fireEvent.change(within(panel()).getByRole("textbox", { name: "补投核对原因" }), { target: { value: "x".repeat(501) } });
    await user.click(within(panel()).getByRole("button", { name: "核对并申请补投" }));
    expect(within(panel()).getByRole("alert")).toHaveTextContent("最多 500 字");
    expect(posts()).toHaveLength(0);
  });
});
