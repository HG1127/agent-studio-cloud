import { Children, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HarnessPage from "@/app/(console)/harness/page";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { ExecutionPolicySnapshot } from "@/contracts/execution-resources";
import { RunSummary, RunStepView, RunView, TraceEventView } from "@/contracts/run";
import { DiagnosticTrace } from "@/features/harness/DiagnosticTrace";
import { RunDiagnostics } from "@/features/harness/RunDiagnostics";
import { HarnessNavigation, harnessConsoleHref, harnessReturnNavigation } from "@/features/harness/harness-navigation";
import { runReturnHref } from "@/features/runs/run-return-url";

const mocks = vi.hoisted(() => ({ listRuns: vi.fn(), getRunView: vi.fn(), listRunSteps: vi.fn(), getRunContext: vi.fn(),
  listRecentTrace: vi.fn(), listTrace: vi.fn(), getResources: vi.fn(), getHistory: vi.fn(), refresh: vi.fn(), replace: vi.fn(), fetch: vi.fn(), safeReadFailures: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace }) }));
vi.mock("@/server/queries/runs", () => ({ listRuns: mocks.listRuns, getRunView: mocks.getRunView, listRunSteps: mocks.listRunSteps, getRunContext: mocks.getRunContext }));
vi.mock("@/server/queries/trace", () => ({ listRecentTrace: mocks.listRecentTrace, listTrace: mocks.listTrace }));
vi.mock("@/server/queries/harness-policies", () => ({ getHarnessPolicyQuery: vi.fn(async () => ({ ok: true, policy: { revision: 0, source: "unconfigured", policy: null, updatedAt: null } })) }));
vi.mock("@/server/actions/save-harness-policy", () => ({ saveHarnessPolicyAction: vi.fn() }));
vi.mock("@/server/actions/simulate-harness-policy", () => ({ simulateHarnessPolicyAction: vi.fn() }));
vi.mock("@/server/queries/execution-resources", () => ({ getExecutionResourcePolicy: mocks.getResources, listExecutionPolicyHistory: mocks.getHistory }));
vi.mock("@/server/security/query-error", () => ({ withSafeQueryError: async (read: () => Promise<unknown>, stage: string) => {
  try { return await read(); } catch (error) { mocks.safeReadFailures(stage, error); throw error; }
} }));

const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherRun = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const run = RunView.parse({ id: runId, agentId: otherRun, agentName: "合同核对助手", version: 1, status: "completed",
  input: {}, result: { message: "已保存" }, error: null, startedAt: "2026-10-12T00:00:00.000Z", finishedAt: "2026-10-12T00:01:00.000Z" });
const summary = RunSummary.parse(run);
const step = RunStepView.parse({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", runId, nodeId: "first", nodeTitle: "读取合同", nodeType: "tool", status: "succeeded",
  attempt: 1, output: null, error: null, startedAt: null, finishedAt: null, createdAt: new Date("2026-10-12T00:00:00Z"), updatedAt: new Date("2026-10-12T00:00:00Z") });
const events = Array.from({ length: 615 }, (_, index) => TraceEventView.parse({ id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  seq: index + 1, nodeId: "first", kind: index % 2 ? "run.saved" : "harness.policy", level: index % 10 ? "info" : "warn",
  title: `合同轨迹 ${index + 1}`, detail: null, at: "2026-10-12T00:00:00.000Z" }));
const recent = events.slice(-500);
const resources = ExecutionPolicySnapshot.parse({ policy: { revision: 0, source: "default", limits: { maxConcurrentChains: 50, maxModelCalls: 200, maxChildRuns: 100 }, updatedAt: null },
  capacity: { reservedChains: 0, untrackedActiveRuns: 0, availableSlots: 50 }, assessedAt: "2026-10-12T00:00:00.000Z" });
const params = { run: runId, runQuery: "合同", contextPage: "3", contextQuery: "资料", traceRange: "history", tracePage: "2" };
const navigation = HarnessNavigation.parse({ runId, list: { query: "合同" }, trace: { range: "history", page: 2 }, context: { page: 3, query: "资料" } });

function clientTraceProps(node: ReactNode): ComponentProps<typeof DiagnosticTrace> | undefined {
  let found: ComponentProps<typeof DiagnosticTrace> | undefined;
  Children.forEach(node, (child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return;
    if (child.type === DiagnosticTrace) found = (child as unknown as ReactElement<ComponentProps<typeof DiagnosticTrace>>).props;
    else found ??= clientTraceProps(child.props.children);
  });
  return found;
}

describe("真实 Harness 父页、诊断与选择器历史接线（只替换 I/O，未执行）", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.listRuns.mockResolvedValue([summary, RunSummary.parse({ ...summary, id: otherRun, agentName: "合同复核助手" })]);
    mocks.getRunView.mockResolvedValue(run);
    mocks.listRunSteps.mockResolvedValue([step]);
    mocks.getRunContext.mockResolvedValue({ outputs: { first: { message: "已保存过程资料" } } });
    mocks.listRecentTrace.mockResolvedValue(recent);
    mocks.listTrace.mockResolvedValue(events);
    mocks.getResources.mockResolvedValue(resources);
    mocks.getHistory.mockResolvedValue({ ok: true, items: [], nextBeforeRevision: null });
    mocks.fetch.mockRejectedValue(new Error("unexpected-browser-io"));
    vi.stubGlobal("fetch", mocks.fetch);
  });

  it("默认只读最近五百条；进入历史的真实入口必须手动且不预取", async () => {
    const page = await HarnessPage({ searchParams: Promise.resolve({ run: runId }) });
    expect({ failures: mocks.safeReadFailures.mock.calls.filter(([stage]) => stage === "harness-run"), runCalls: mocks.getRunView.mock.calls })
      .toEqual({ failures: [], runCalls: [[runId, DEMO_WORKSPACE_ID]] });
    render(page);
    expect(document.querySelectorAll('li[id^="diagnostic-event-"]')).toHaveLength(500);
    expect(mocks.listTrace).not.toHaveBeenCalled();
    const entry = screen.getByRole("link", { name: "核对较早轨迹" });
    expect(new URL(entry.getAttribute("href")!, "https://test.invalid").searchParams.get("traceRange")).toBe("history");
    expect(screen.queryByText(/本次读到.*可解析历史事件/)).not.toBeInTheDocument();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("真实服务端诊断只给客户端当前五十条及标量摘要，不传整个历史数组", () => {
    const props = clientTraceProps(RunDiagnostics({ run, steps: [step], trace: recent, historyTrace: events, navigation }));
    expect(props?.events).toHaveLength(50);
    expect(props?.events.map((event) => event.seq)).toEqual(Array.from({ length: 50 }, (_, index) => index + 51));
    expect(props?.historyPage).toMatchObject({ total: 615, page: 2, lastPage: 13, selectedCount: 615 });
    expect(props?.historyPage && Object.values(props.historyPage).every((value) => typeof value === "number" || typeof value === "boolean")).toBe(true);
    expect(props).not.toHaveProperty("historyTrace");
  });

  it("历史独立读取，原概览仍来自最近；真实选择器跨任务清范围，真实返回保护保留同任务", async () => {
    render(await HarnessPage({ searchParams: Promise.resolve(params) }));
    expect(mocks.listTrace).toHaveBeenCalledExactlyOnceWith(runId, expect.any(String));
    expect(mocks.listRecentTrace).toHaveBeenCalledExactlyOnceWith(runId, expect.any(String));
    expect(document.querySelectorAll('li[id^="diagnostic-event-"]')).toHaveLength(50);
    expect(document.getElementById("diagnostic-event-51")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "本次证据读取" })).getByText("已读取 500 条最近事件")).toBeInTheDocument();
    expect(screen.getByText(/证据概览与上方最近需关注事件仍来自最近事件/)).toBeInTheDocument();
    expect(screen.getByText(/本次读到 615 条可解析历史事件/)).toBeInTheDocument();
    const detail = new URL(screen.getByRole("link", { name: "打开任务详情" }).getAttribute("href")!, "https://test.invalid");
    expect(runReturnHref(detail.searchParams.get("from")!)).toBe(harnessConsoleHref(navigation));
    const switched = within(screen.getByRole("navigation", { name: "选择诊断任务" })).getByRole("link", { name: /合同复核助手/ });
    const next = harnessReturnNavigation(switched.getAttribute("href")!);
    expect(next?.runId).toBe(otherRun);
    expect(next?.trace.range).toBeUndefined();
    expect(next?.trace.nodeId).toBe("");
    expect(next?.context).toEqual({ page: 1, query: "" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each([{ traceRange: "history" }, { run: "bad", traceRange: "history" }, { run: [runId, otherRun], traceRange: "history" },
    { run: runId, traceRange: ["history", "history"] }, { run: runId, traceRange: "recent" },
    { run: runId, traceRange: "history", tracePage: "0" }, { run: runId, traceRange: "history", tracePage: ["2", "2"] }])("无效历史参数绝不触发历史查询：%j", async (search) => {
    render(await HarnessPage({ searchParams: Promise.resolve(search) }));
    expect(mocks.listTrace).not.toHaveBeenCalled();
    expect(document.querySelectorAll('li[id^="diagnostic-event-"]')).toHaveLength(0);
    expect(screen.queryByText("这次运行尚无已保存的轨迹事件。")).not.toBeInTheDocument();
  });

  it("合法大写 UUID 仍核对同一实体；响应属于其他任务时不借历史或其他证据", async () => {
    const view = render(await HarnessPage({ searchParams: Promise.resolve({ ...params, run: runId.toUpperCase() }) }));
    expect(mocks.listTrace).toHaveBeenCalledExactlyOnceWith(runId, expect.any(String));
    view.unmount();
    mocks.listTrace.mockClear(); mocks.listRunSteps.mockClear(); mocks.listRecentTrace.mockClear();
    mocks.getRunView.mockResolvedValueOnce(RunView.parse({ ...run, id: otherRun }));
    render(await HarnessPage({ searchParams: Promise.resolve(params) }));
    expect(mocks.listTrace).not.toHaveBeenCalled();
    expect(mocks.listRunSteps).not.toHaveBeenCalled();
    expect(mocks.listRecentTrace).not.toHaveBeenCalled();
    expect(screen.getByText("诊断详情暂时无法读取")).toBeInTheDocument();
  });

  it("历史失败不替换成最近或空，最近、步骤、快照和资源仍可核对", async () => {
    mocks.listTrace.mockRejectedValueOnce(new Error("private-history-read"));
    render(await HarnessPage({ searchParams: Promise.resolve(params) }));
    expect(screen.getByText(/历史轨迹暂时无法读取，数量和内容未知/)).toBeInTheDocument();
    expect(document.querySelectorAll('li[id^="diagnostic-event-"]')).toHaveLength(0);
    expect(screen.getByRole("region", { name: "本次证据读取" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "已保存的步骤" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "已保存的上游结果快照" })).toBeInTheDocument();
    expect(screen.getByText("服务端默认设置")).toBeInTheDocument();
    expect(screen.queryByText(/private-history-read|本次读取没有可解析的历史事件/)).not.toBeInTheDocument();
  });

  it("历史空可读范围及页码溢出各自说明，不自动扩大、返回最近或换任务", async () => {
    mocks.listTrace.mockResolvedValueOnce([]);
    const view = render(await HarnessPage({ searchParams: Promise.resolve(params) }));
    expect(screen.getByText(/这个历史页没有可读事件，不表示整个范围为空/)).toBeInTheDocument();
    const last = screen.getByRole("link", { name: "返回历史最后一页" });
    const url = new URL(last.getAttribute("href")!, "https://test.invalid");
    expect(url.searchParams.get("run")).toBe(runId);
    expect(url.searchParams.get("traceRange")).toBe("history");
    expect(url.searchParams.has("tracePage")).toBe(false);
    view.unmount();
    render(await HarnessPage({ searchParams: Promise.resolve({ ...params, tracePage: "10000" }) }));
    expect(document.querySelectorAll('li[id^="diagnostic-event-"]')).toHaveLength(0);
    expect(screen.getByRole("link", { name: "返回历史最后一页" })).toHaveAttribute("href", harnessConsoleHref({ ...navigation, trace: { ...navigation.trace, page: 13 } }, "diagnostic-trace"));
  });

  it("历史填写只导航重新读取并重置页码；当前页不假装全历史客户端筛选", async () => {
    render(await HarnessPage({ searchParams: Promise.resolve(params) }));
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索已读取的轨迹" }), { target: { value: "没有匹配" } });
    expect(document.querySelectorAll('li[id^="diagnostic-event-"]')).toHaveLength(50);
    expect(screen.getByText(/当前填写尚未应用/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "历史下一页" })).not.toBeInTheDocument();
    fireEvent.submit(screen.getByRole("form", { name: "已读取轨迹筛选" }));
    expect(mocks.replace).toHaveBeenCalledWith(harnessConsoleHref({ ...navigation, trace: { ...navigation.trace, query: "没有匹配", page: 1 } }, "diagnostic-trace"), { scroll: false });
    expect(mocks.listTrace).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
