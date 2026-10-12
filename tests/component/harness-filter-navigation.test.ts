import { describe, expect, it } from "vitest";
import { HarnessNavigation, harnessConsoleHref, harnessNavigation, harnessReturnNavigation, harnessRunDetailHref, harnessRunHref } from "@/features/harness/harness-navigation";
import { runContextHref } from "@/features/harness/run-context-navigation";
import { runReturnHref } from "@/features/runs/run-return-url";
import { childRunHref, collaborationNavigation } from "@/features/runs/run-collaboration-navigation";

const runId = "00000000-0000-4000-8000-000000000081";
const childId = "00000000-0000-4000-8000-000000000082";
const state = HarnessNavigation.parse({
  runId, list: { query: "合同 & 财务", attention: true },
  trace: { query: "提醒 + 核对", nodeId: "group:one/node-two", attention: true },
  context: { page: 2, query: "资料" },
});

describe("诊断已应用范围的安全往返", () => {
  it("省略默认值，旧的固定任务地址保持不变", () => {
    expect(harnessConsoleHref(HarnessNavigation.parse({}))).toBe("/harness");
    expect(harnessRunHref(runId)).toBe(`/harness?run=${runId}`);
    expect(harnessReturnNavigation(harnessRunHref(runId))).toEqual(HarnessNavigation.parse({ runId }));
  });
  it("任务列表、轨迹和快照按同一范围往返，中文与符号不变成新参数", () => {
    const href = harnessConsoleHref(state);
    const restored = harnessReturnNavigation(href);
    expect(restored).toEqual(state);
    expect(runReturnHref(href)).toBe(href);
    const detail = new URL(harnessRunDetailHref(runId, "run-waiting", state), "https://local.invalid");
    expect(detail.hash).toBe("#run-waiting");
    expect(detail.searchParams.get("from")).toBe(href);
    expect(runReturnHref(detail.searchParams.get("from")!)).toBe(href);
  });
  it("只修改快照页码时保留任务和轨迹条件，不保留任意锚点", () => {
    const url = new URL(runContextHref(runId, { page: 3, query: "结论" }, state), "https://local.invalid");
    expect(url.hash).toBe("#saved-context");
    expect(harnessReturnNavigation(url.pathname + url.search)).toEqual({ ...state, context: { page: 3, query: "结论" } });
    expect(runReturnHref(url.pathname + url.search + url.hash)).toBe("/runs");
  });
  it("协作子任务及精确上级返回仍保留原诊断范围，不递归嵌套返回地址", () => {
    const origin = harnessConsoleHref(state);
    const child = new URL(childRunHref(childId, runId, origin, { query: "财务", status: "completed", page: 2 }), "https://local.invalid");
    const params = Object.fromEntries(child.searchParams);
    const parsed = collaborationNavigation(params);
    expect(parsed.backHref).toBe(origin);
    expect(parsed.parent).toEqual({ runId, state: { query: "财务", status: "completed", page: 2 } });
    expect(parsed.invalidParent).toBe(false);
    expect(child.searchParams.getAll("from")).toEqual([origin]);
  });
  it("不同分区无效条件分别标记，不静默认定为已应用全部范围", () => {
    const parsed = harnessNavigation({ run: runId, runQuery: ["合同", "财务"], traceNode: ["one", "two"], contextPage: "0" });
    expect(parsed.invalidRun).toBe(false);
    expect(parsed.invalidList).toBe(true);
    expect(parsed.invalidTrace).toBe(true);
    expect(parsed.context.success).toBe(false);
    expect(parsed.state.runId).toBe(runId);
  });
  it("合法空关键词正常归一化，不改变实际步骤关联字符串", () => {
    const parsed = harnessNavigation({ run: runId, runQuery: "  ", traceQuery: "  提醒  ", traceNode: "group:one/node-two", contextPage: "1" });
    expect(parsed.invalidList).toBe(false);
    expect(parsed.invalidTrace).toBe(false);
    expect(parsed.state.trace).toEqual({ query: "提醒", nodeId: "group:one/node-two", attention: false });
    expect(harnessConsoleHref(parsed.state)).not.toContain("contextPage");
  });
  it("最长中文关键词的返回地址不因旧的五百字符限制丢失", () => {
    const longState = HarnessNavigation.parse({ runId, list: { query: "合".repeat(100) }, trace: { query: "核".repeat(100) }, context: { page: 1, query: "资".repeat(100) } });
    const href = harnessConsoleHref(longState);
    expect(href.length).toBeGreaterThan(512);
    expect(runReturnHref(href)).toBe(href);
  });
  it("有界中文步骤关联与三个最长关键词可完整恢复，超出编码预算明确无效", () => {
    const full = HarnessNavigation.parse({ runId, list: { query: "合".repeat(100) }, trace: { query: "核".repeat(100), nodeId: "节".repeat(333) }, context: { page: 1, query: "资".repeat(100) } });
    const href = harnessConsoleHref(full);
    expect(href.length).toBeLessThan(8192);
    expect(harnessReturnNavigation(href)).toEqual(full);
    expect(harnessNavigation({ run: runId, traceNode: "节".repeat(1000) }).invalidTrace).toBe(true);
  });
  it.each([
    "https://outside.example/harness?run=" + runId,
    "//outside.example/harness?run=" + runId,
    "/harness", "/harness?run=invalid", "/harness?run=",
    "/harness?run=" + runId + "#saved-context",
    "/harness?run=" + runId + "&from=/harness?run=" + runId,
    "/harness?run=" + runId + "&redirect=https://outside.example",
    "/harness?run=" + runId + "&constructor=x",
    "/harness?run=" + runId + "&__proto__=x",
    "/harness?run=" + runId + "&run=" + childId,
    "/harness?run=" + runId + "&runQuery=one&runQuery=two",
    "/harness?run=" + runId + "&traceNode=one&traceNode=two",
    "/harness?run=" + runId + "&traceAttention=1&traceAttention=1",
    "/harness?run=" + runId + "&contextQuery=one&contextQuery=two",
    "/harness?run=" + runId + "&contextPage=01",
    "/harness?run=" + runId + "&contextPage=100000",
    "/harness?run=" + runId + "&runAttention=false",
    "/harness?run=" + runId + "&traceAttention=all",
    "/harness?run=" + runId + "&runQuery=" + "x".repeat(101),
    "/harness?run=" + runId + "&traceQuery=" + "x".repeat(101),
    "/harness?run=" + runId + "&traceNode=" + "x".repeat(1001),
    "/harness?run=" + runId + "&contextQuery=" + "x".repeat(101),
    "/harness?run=" + runId + "&runQuery=" + "x".repeat(8192),
  ])("无效或非白名单返回地址不使用 %s", (raw) => {
    expect(harnessReturnNavigation(raw)).toBeNull();
    expect(runReturnHref(raw)).toBe("/runs");
  });
});
