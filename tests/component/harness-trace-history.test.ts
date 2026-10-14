import { describe, expect, it } from "vitest";
import { TraceEventView } from "@/contracts/run";
import { HarnessNavigation, harnessConsoleHref, harnessNavigation, harnessReturnNavigation, harnessRunDetailHref, harnessRunHref } from "@/features/harness/harness-navigation";
import { TRACE_HISTORY_PAGE_SIZE, traceHistoryView } from "@/features/harness/trace-history-view";

const runId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherRun = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const event = (seq: number, overrides: Partial<TraceEventView> = {}) => TraceEventView.parse({
  id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, seq, nodeId: "first", kind: "run.step",
  level: "info", title: `合同记录 ${seq}`, detail: null, at: "2026-10-12T00:00:00.000Z", ...overrides,
});
const historyNavigation = () => HarnessNavigation.parse({ runId, list: { query: "合同", attention: true },
  trace: { query: "", nodeId: "", attention: false, range: "history", page: 2 }, context: { page: 3, query: "资料" } });

describe("历史可读轨迹的导航与服务端分页派生（源码规格未执行）", () => {
  it("默认仍是最近范围，历史必须有确切运行编号与显式范围", () => {
    expect(harnessNavigation({ run: runId }).state.trace.range).toBeUndefined();
    const parsed = harnessNavigation({ run: runId, traceRange: "history", tracePage: "2" });
    expect(parsed.invalidTrace).toBe(false);
    expect(parsed.state.trace).toMatchObject({ range: "history", page: 2 });
    expect(HarnessNavigation.safeParse({ trace: { query: "", nodeId: "", attention: false, range: "history" } }).success).toBe(false);
  });

  it.each([
    { traceRange: "history" }, { run: "invalid", traceRange: "history" },
    { run: [runId, otherRun], traceRange: "history" }, { run: runId, traceRange: ["history", "history"] },
    { run: runId, traceRange: "all" }, { run: runId, traceRange: "recent" },
    { run: runId, tracePage: "2" }, { run: runId, traceRange: "history", tracePage: "0" },
    { run: runId, traceRange: "history", tracePage: "01" }, { run: runId, traceRange: "history", tracePage: "10001" },
    { run: runId, traceRange: "history", tracePage: ["2", "3"] }, { run: runId, traceRange: "history", tracePage: "1.5" },
  ])("无效或重复历史条件不降级成有效历史范围：%j", (params) => {
    const parsed = harnessNavigation(params);
    expect(parsed.invalidTrace).toBe(true);
    expect(parsed.state.trace.range).toBeUndefined();
  });

  it("同任务保留历史、筛选、快照和返回链，其他任务只保留列表范围", () => {
    const navigation = historyNavigation();
    const href = harnessConsoleHref(navigation);
    expect(harnessReturnNavigation(href)).toEqual(navigation);
    expect(new URL(harnessRunDetailHref(runId, "trace", navigation), "https://test.invalid").searchParams.get("from")).toBe(href);
    expect(harnessReturnNavigation(harnessRunHref(runId.toUpperCase(), navigation))?.trace).toEqual(navigation.trace);
    const switched = harnessReturnNavigation(harnessRunHref(otherRun, navigation));
    expect(switched?.runId).toBe(otherRun);
    expect(switched?.list).toEqual(navigation.list);
    expect(switched?.trace).toEqual(HarnessNavigation.parse({}).trace);
    expect(switched?.context).toEqual({ page: 1, query: "" });
    expect(harnessReturnNavigation(href + "&tracePage=3")).toBeNull();
    expect(harnessReturnNavigation(href + "&unknown=1")).toBeNull();
  });

  it("同次已读取数据只派生每页五十条，保留真实顺序且不修改输入", () => {
    const events = Array.from({ length: 615 }, (_, index) => event(index + 1));
    const original = structuredClone(events);
    const view = traceHistoryView(events, historyNavigation().trace);
    expect(TRACE_HISTORY_PAGE_SIZE).toBe(50);
    expect(view).toMatchObject({ total: 615, selectedCount: 615, page: 2, lastPage: 13, outOfRange: false });
    expect(view.events.map((item) => item.seq)).toEqual(Array.from({ length: 50 }, (_, index) => index + 51));
    expect(events).toEqual(original);
    expect(traceHistoryView(events, { ...historyNavigation().trace, page: 13 }).events).toHaveLength(15);
  });

  it("先在历史可读数据应用名称、步骤、类型和级别，再做分页；未知类型仍可核对", () => {
    const events = [event(1, { kind: "harness.policy", level: "warn" }), event(2, { kind: "harness.policy" }),
      event(3, { kind: "harness.context", level: "warn" }), event(4, { kind: "harness.policy", level: "warn", nodeId: "second" }),
      event(5, { kind: "future.saved.event", level: "warn" })];
    const filters = { ...historyNavigation().trace, query: "合同", nodeId: "first", attention: true, kind: "policy" as const, page: 1 };
    const view = traceHistoryView(events, filters);
    expect(view.events.map((item) => item.seq)).toEqual([1]);
    expect(view).toMatchObject({ total: 5, scopedCount: 2, attentionCount: 1, selectedCount: 1 });
    expect(traceHistoryView(events, { ...filters, kind: "other" }).events.map((item) => item.seq)).toEqual([5]);
  });

  it("溢出页不自动回第一页；空可解析记录只是本次读数", () => {
    const events = [event(1)];
    expect(traceHistoryView(events, { ...historyNavigation().trace, page: 10000 })).toMatchObject({
      total: 1, page: 10000, lastPage: 1, outOfRange: true, events: [],
    });
    expect(traceHistoryView([], { ...historyNavigation().trace, page: 1 })).toMatchObject({ total: 0, selectedCount: 0, events: [] });
  });
});
