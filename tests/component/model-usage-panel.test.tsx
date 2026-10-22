import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunModelUsagePanel } from "@/features/runs/RunModelUsagePanel";
import { ChainModelUsageSummary, modelUsageQuantity, SingleModelUsageSummary } from "@/features/runs/ModelUsageSummary";
import { chainFixture, completeUsage, usageChildId, usageFixture, usageRunId } from "../fixtures/model-usage";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function currentPanel() { return screen.getByRole("article", { name: "当前任务自身" }); }
function chainPanel() { return screen.getByRole("article", { name: "已纳入的协作链" }); }
function figure(element: HTMLElement, label: string) {
  const figures = element.querySelector(":scope > dl");
  expect(figures).not.toBeNull();
  return within(figures as HTMLElement).getByText(label, { selector: "dt" }).nextElementSibling!;
}
function respond(current = completeUsage(), chain = chainFixture()) {
  const fetcher = vi.fn(async (url: string) => Response.json({ ok: true, summary: url.endsWith("/chain") ? chain : current }));
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { resolve, promise };
}

describe("模型用量展示与范围边界", () => {
  it.each([null, 0, 10, Number.MAX_SAFE_INTEGER])("展示真实数值 %s，不把未知变零", (value) => {
    expect(modelUsageQuantity(value)).toBe(value === null ? "未知" : value.toLocaleString("zh-CN"));
  });
  it("单任务与协作链分开，显示真实零、报告范围与北京时间", async () => {
    const fetcher = respond(); render(<RunModelUsagePanel runId={usageRunId} />);
    await waitFor(() => expect(figure(currentPanel(), "已知输入用量")).toHaveTextContent("10"));
    expect(figure(currentPanel(), "已知输出用量")).toHaveTextContent(/^0$/);
    expect(figure(chainPanel(), "已知输入用量")).toHaveTextContent("未知");
    expect(screen.getByText(/不能把它们相加/)).toBeVisible();
    expect(currentPanel()).toHaveTextContent("报告齐全，不代表任务已结束");
    expect(currentPanel().querySelector("time")).toHaveAttribute("dateTime", completeUsage().assessedAt);
    expect(currentPanel()).toHaveTextContent("北京时间");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toContain(usageRunId);
    expect(screen.queryByText(/最终用量|预计费用|预算已生效/)).not.toBeInTheDocument();
  });
  it("历史空记录不证明无调用，无用量不能当零", () => {
    render(<SingleModelUsageSummary summary={usageFixture({ tracking: "legacy-or-partial", usage: { recordedUsageComplete: false } })} />);
    expect(screen.getByText(/历史或不完整登记/)).toBeVisible();
    expect(screen.getAllByText("未知")).toHaveLength(3);
    expect(screen.queryByText(/尚无已登记/)).not.toBeInTheDocument();
  });
  it("真正空的已登记快照只说明当前范围，不显示虚假的零合计", () => {
    render(<SingleModelUsageSummary summary={usageFixture()} />);
    expect(screen.getByText(/本次快照尚无已登记/)).toBeVisible();
    expect(screen.getAllByText("未知")).toHaveLength(3);
  });
  it.each(["pending", "failed", "partial", "invalid"] as const)("区分 %s 调用，不加总未知报告", (kind) => {
    const usage = usageFixture({ calls: { total: 1, pending: kind === "pending" ? 1 : 0, failed: kind === "failed" ? 1 : 0,
      returned: kind === "partial" || kind === "invalid" ? 1 : 0 }, usage: { incompleteCalls: 1, recordedUsageComplete: false,
      inputCalls: kind === "partial" ? 1 : 0, knownInputTokens: kind === "partial" ? 0 : null, invalidUsageCalls: kind === "invalid" ? 1 : 0 } });
    render(<SingleModelUsageSummary summary={usage} />);
    expect(screen.getByText(/报告仍不完整/)).toBeVisible();
    expect(screen.getByText("完整报告的已知合计", { selector: "dt" }).nextElementSibling).toHaveTextContent("未知");
    if (kind === "partial") expect(screen.getByText("已知输入用量", { selector: "dt" }).nextElementSibling).toHaveTextContent(/^0$/);
  });
  it.each(["missingParent", "cycleDetected", "truncated"] as const)("协作链 %s 限制不能冒充完整总量", (flag) => {
    render(<ChainModelUsageSummary summary={chainFixture({ flags: { [flag]: true } })} />);
    expect(screen.getByText(/只能核对部分协作范围/)).toBeVisible();
    expect(screen.getByRole("list", { name: "协作统计限制" })).toBeVisible();
    expect(screen.getByText(/不是最终执行快照/)).toBeVisible();
  });
  it("明确展示历史关系、未登记调用和未知状态，各任务不重复加子任务", () => {
    const root = usageFixture({ tracking: "legacy-or-partial", usage: { recordedUsageComplete: false } });
    const summary = chainFixture({ runs: [
      { parentRunId: null, depth: 0, status: "completed", relation: "root", relationTracking: "tracked-v1", summary: root },
      { parentRunId: usageRunId, depth: 1, status: "unknown", relation: "legacy", relationTracking: "legacy-or-partial", summary: completeUsage(usageChildId, 20) },
    ] });
    render(<ChainModelUsageSummary summary={summary} />);
    expect(screen.getByRole("list", { name: "协作统计限制" })).toHaveTextContent("历史关系 1 项");
    expect(screen.getByRole("list", { name: "协作统计限制" })).toHaveTextContent("调用登记不完整 1 项");
    expect(screen.getByRole("list", { name: "协作统计限制" })).toHaveTextContent("状态未知 1 项");
    fireEvent.click(screen.getByText("查看已纳入任务的用量（2）"));
    expect(screen.getByRole("link", { name: "关联任务 2" })).toHaveAttribute("href", "/runs/" + usageChildId + "#model-usage");
    expect(screen.getByText(/不重复加入其协作子任务/)).toBeVisible();
    expect(document.body.textContent).not.toContain(usageChildId);
  });
  it("终态的执行快照仍不冒充最终账单或完整报告", () => {
    render(<ChainModelUsageSummary summary={chainFixture({ runs: [{ parentRunId: null, depth: 0, status: "failed", relation: "root",
      relationTracking: "tracked-v1", summary: usageFixture({ calls: { total: 1, failed: 1 }, usage: { incompleteCalls: 1, recordedUsageComplete: false } }) }] })} />);
    expect(screen.getByText(/纳入任务均已结束/)).toBeVisible();
    expect(screen.getByText(/报告或调用登记仍不完整/)).toBeVisible();
    expect(screen.getByText(/不是最终账单/)).toBeVisible();
  });
  it.each(["current", "chain"] as const)("读取 %s 失败保留另一范围，错误不按空统计", async (failed) => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/chain") === (failed === "chain")
      ? Response.json({ ok: false, error: "private-upstream" }, { status: 503 })
      : Response.json({ ok: true, summary: url.endsWith("/chain") ? chainFixture() : completeUsage() })));
    render(<RunModelUsagePanel runId={usageRunId} />);
    const bad = failed === "current" ? currentPanel() : chainPanel(), good = failed === "current" ? chainPanel() : currentPanel();
    await waitFor(() => expect(within(bad).getByRole("alert")).toHaveTextContent("不能当作零"));
    expect(figure(good, "已登记调用")).toBeVisible();
    expect(within(bad).queryByText("已登记调用", { selector: "dt" })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("private-upstream");
  });
  it("慢读取可取消本页旧请求并重读，不无限锁住操作", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() => new Promise<Response>(() => {})); vi.stubGlobal("fetch", fetcher);
    render(<RunModelUsagePanel runId={usageRunId} />);
    expect(screen.getByRole("button", { name: "正在读取用量…" })).toBeDisabled();
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByRole("button", { name: "重新读取用量" })).toBeEnabled();
    expect(screen.getByText(/部分统计读取较慢/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "重新读取用量" }));
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(fetcher.mock.calls[1][1].signal?.aborted).toBe(true);
    expect(screen.getByRole("button", { name: "正在读取用量…" })).toBeDisabled();
  });
  it("切换任务及卸载真实取消，迟到回执不污染新任务", async () => {
    const reads = [deferred(), deferred(), deferred(), deferred()];
    let nextRead = 0;
    const fetcher = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() => reads[nextRead++].promise); vi.stubGlobal("fetch", fetcher);
    const view = render(<RunModelUsagePanel runId={usageRunId} />);
    view.rerender(<RunModelUsagePanel runId={usageChildId} />);
    expect(fetcher.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(fetcher.mock.calls[1][1].signal?.aborted).toBe(true);
    await act(async () => {
      reads[2].resolve(Response.json({ ok: true, summary: completeUsage(usageChildId, 30) }));
      reads[3].resolve(Response.json({ ok: true, summary: chainFixture({ runs: [{ ...chainFixture().runs[0], summary: completeUsage(usageChildId, 30) }] }) }));
    });
    await waitFor(() => expect(figure(currentPanel(), "已知输入用量")).toHaveTextContent("30"));
    await act(async () => { reads[0].resolve(Response.json({ ok: true, summary: completeUsage() })); reads[1].resolve(Response.json({ ok: true, summary: chainFixture() })); });
    expect(figure(currentPanel(), "已知输入用量")).toHaveTextContent("30");
    view.unmount();
    expect(fetcher.mock.calls[2][1].signal?.aborted).toBe(true);
    expect(fetcher.mock.calls[3][1].signal?.aborted).toBe(true);
  });
  it("手动读取清除旧数字，不轮询或写入", async () => {
    const fetcher = respond(); render(<RunModelUsagePanel runId={usageRunId} />);
    await waitFor(() => expect(figure(currentPanel(), "已知输入用量")).toHaveTextContent("10"));
    fetcher.mockImplementation(() => new Promise<Response>(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "重新读取用量" }));
    expect(within(currentPanel()).queryByText("已知输入用量", { selector: "dt" })).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(4);
    for (const call of fetcher.mock.calls) expect(call[0]).toMatch(/\/usage(?:\/chain)?$/);
  });
  it("不匹配共享记录拒绝显示，不把其他任务数字挂到当前任务", async () => {
    respond(completeUsage(usageChildId), chainFixture());
    render(<RunModelUsagePanel runId={usageRunId} />);
    await waitFor(() => expect(within(currentPanel()).getByRole("alert")).toBeVisible());
    expect(within(currentPanel()).queryByText("已知输入用量", { selector: "dt" })).not.toBeInTheDocument();
  });
  it("未确认起始任务及无效关系不虚构完整上级关系", () => {
    render(<ChainModelUsageSummary summary={chainFixture({ rootKnown: false,
      runs: [{ ...chainFixture().runs[0], relation: "invalid" }] })} />);
    expect(screen.getByRole("list", { name: "协作统计限制" })).toHaveTextContent("起始任务未确认");
    expect(screen.getByRole("list", { name: "协作统计限制" })).toHaveTextContent("无法核对关系 1 项");
    expect(screen.getByText(/只能核对部分协作范围/)).toBeVisible();
  });
  it("完整保留真实上限内的两百项明细，不额外截断或重复汇总", () => {
    const root = chainFixture().runs[0];
    const children = Array.from({ length: 199 }, (_, index) => ({ ...root, parentRunId: usageRunId, depth: 1, relation: "explicit" as const,
      summary: usageFixture({ runId: "00000000-0000-4000-8000-" + String(index + 101).padStart(12, "0") }) }));
    render(<ChainModelUsageSummary summary={chainFixture({ runs: [root, ...children] })} />);
    expect(screen.getByText("查看已纳入任务的用量（200）")).toBeInTheDocument();
    expect(document.querySelectorAll("ol > li")).toHaveLength(200);
    expect(screen.getByRole("link", { name: "关联任务 200" })).toHaveAttribute("href", "/runs/00000000-0000-4000-8000-000000000299#model-usage");
  });
});
