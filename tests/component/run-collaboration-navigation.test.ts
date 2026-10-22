import { describe, expect, it } from "vitest";
import { childRunHref, collaborationHref, collaborationNavigation, CollaborationListState } from "@/features/runs/run-collaboration-navigation";

const parentId = "00000000-0000-4000-8000-000000000001";
const childId = "00000000-0000-4000-8000-000000000002";
const state = CollaborationListState.parse({ query: "客户核对", sourceType: "handoff", status: "failed", page: 3 });
const outer = "/runs/attention?source=manual&approvalPage=2&eventPage=3&failedPage=4";

describe("协作运行的有界安全导航", () => {
  it("默认第一页省略；协作查找只使用本地界面状态", () => {
    expect(collaborationNavigation({})).toEqual({ state: { query: "", page: 1 }, invalidState: false, parent: null, invalidParent: false, backHref: "/runs" });
    expect(collaborationHref(parentId, "/runs", { query: "", page: 1 })).toBe(`/runs/${parentId}#collaboration`);
  });
  it.each([outer, "/runs?status=failed&source=manual&page=3", `/harness?run=${parentId}`])("子任务可返回确切协作页并保留外层来源 %s", (backHref) => {
    const url = new URL(childRunHref(childId, parentId, backHref, state), "https://local.invalid");
    const parsed = collaborationNavigation(Object.fromEntries(url.searchParams));
    expect(parsed.parent).toEqual({ runId: parentId, state });
    expect(parsed.state).toEqual({ query: "", page: 1 });
    expect(parsed.backHref).toBe(backHref);
    const back = new URL(collaborationHref(parentId, parsed.backHref, parsed.parent!.state), "https://local.invalid");
    expect(back.pathname).toBe(`/runs/${parentId}`);
    expect(back.hash).toBe("#collaboration");
    expect(collaborationNavigation(Object.fromEntries(back.searchParams)).state).toEqual(state);
  });
  it.each([
    { colPage: "0" }, { colPage: "-1" }, { colPage: "1.5" }, { colPage: "01" }, { colPage: "10001" },
    { colPage: "" }, { colPage: ["2", "3"] }, { colQuery: ["客户", "核对"] }, { colQuery: "字".repeat(101) },
    { colType: "mcp" }, { colStatus: "waiting_child" }, { colType: ["handoff", "agent_call"] },
  ])("错误筛选不静默冒充正确筛选 %j", (params) => {
    const parsed = collaborationNavigation(params);
    expect(parsed.invalidState).toBe(true);
    expect(parsed.state).toEqual({ query: "", page: 1 });
  });
  it("合法查询去除空格，页码限制独立；不改变返回的上级筛选", () => {
    const parsed = collaborationNavigation({ colQuery: " 核对 ", colPage: "10000", parent: parentId, parentPage: "3", parentStatus: "failed" });
    expect(parsed.state).toEqual({ query: "核对", page: 10000 });
    expect(parsed.parent?.state).toEqual({ query: "", page: 3, status: "failed" });
  });
  it.each([
    { parent: "../outside" }, { parent: [parentId, childId] }, { parentPage: "2" },
    { parent: parentId, parentPage: "10001" }, { parent: parentId, parentType: "manual" },
    { parent: parentId, parentQuery: ["核对", "客户"] },
  ])("无效或歧义的上级位置明确拒绝 %j", (params) => {
    const parsed = collaborationNavigation(params);
    expect(parsed.parent).toBeNull();
    expect(parsed.invalidParent).toBe(true);
  });
  it.each(["https://outside.example", "//outside.example/runs", `/runs/${parentId}?from=/runs`, "/runs/../agents", "/harness?run=invalid"])("不允许任意返回地址或递归链 %s", (from) => {
    const parsed = collaborationNavigation({ from });
    expect(parsed.backHref).toBe("/runs");
    expect(new URL(childRunHref(childId, parentId, from, state), "https://local.invalid").searchParams.has("from")).toBe(false);
  });
  it("重复来源不选取其中一个，构造器拒绝非法任务标识", () => {
    expect(collaborationNavigation({ from: [outer, "https://outside.example"] }).backHref).toBe("/runs");
    expect(() => childRunHref("constructor", parentId, outer, state)).toThrow();
    expect(() => collaborationHref(parentId, outer, { ...state, page: 10001 })).toThrow();
  });
});
