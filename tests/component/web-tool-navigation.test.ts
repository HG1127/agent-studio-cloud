import { describe, expect, it } from "vitest";
import { webToolNavigation, webToolHref, webToolRunHref, webToolReturnNavigation } from "@/features/web-tools/web-tool-navigation";
import { runReturnHref } from "@/features/runs/run-return-url";
import { childRunHref, collaborationNavigation, CollaborationListState } from "@/features/runs/run-collaboration-navigation";

const versionId = "00000000-0000-4000-8000-000000000101";
const runId = "00000000-0000-4000-8000-000000000102";
const childId = "00000000-0000-4000-8000-000000000103";
const href = `/web-tools?version=${versionId}&trial=${runId}`;

describe("网页试运行的有界安全往返", () => {
  it("默认与来源选择不补造任务；详情返回精确的版本和任务", () => {
    expect(webToolNavigation({})).toEqual({ state: {}, invalid: false });
    expect(webToolHref({})).toBe("/web-tools");
    expect(webToolHref({ versionId })).toBe(`/web-tools?version=${versionId}`);
    const detail = new URL(webToolRunHref(versionId, runId), "https://local.invalid");
    expect(detail.pathname).toBe(`/runs/${runId}`);
    expect(detail.searchParams.get("from")).toBe(href);
    expect(webToolReturnNavigation(href)).toEqual({ versionId, runId });
    expect(runReturnHref(href)).toBe(href);
  });
  it("白名单返回规范化顺序，不提供任意跳转入口", () => {
    expect(runReturnHref(`/web-tools?trial=${runId}&version=${versionId}`)).toBe(href);
  });
  it("协作子任务往返仍保留真实上级及网页原来源，不拿子任务冒充试运行", () => {
    const child = new URL(childRunHref(childId, runId, href, CollaborationListState.parse({ page: 2 })), "https://local.invalid");
    const parsed = collaborationNavigation(Object.fromEntries(child.searchParams));
    expect(parsed.backHref).toBe(href);
    expect(parsed.parent?.runId).toBe(runId);
    expect(parsed.parent?.state.page).toBe(2);
  });
  it.each([
    { version: "" }, { version: "../elsewhere" }, { version: [versionId, versionId] },
    { trial: runId }, { version: versionId, trial: "" }, { version: versionId, trial: "not-a-run" },
    { version: versionId, trial: [runId, childId] },
  ])("无效或重复参数不静默选择一个值 %j", (params) => {
    expect(webToolNavigation(params)).toEqual({ state: {}, invalid: true });
  });
  it.each([
    "/web-tools", `/web-tools?version=${versionId}`, `/web-tools?trial=${runId}`,
    `${href}&trial=${runId}`, `${href}&version=${versionId}`, `${href}&from=/runs`,
    `${href}&redirect=https://outside.invalid`, `${href}#result`, `${href}&unexpected=1`,
    `https://outside.invalid${href}`, `//outside.invalid${href}`, `/web-tools/../runs?version=${versionId}&trial=${runId}`,
  ])("返回位置拒绝歧义、递归、外站和未知参数 %s", (raw) => {
    expect(webToolReturnNavigation(raw)).toBeNull();
    expect(runReturnHref(raw)).toBe("/runs");
  });
  it("构造器拒绝非法来源和任务编号", () => {
    expect(() => webToolHref({ runId })).toThrow();
    expect(() => webToolRunHref("constructor", runId)).toThrow();
    expect(() => webToolRunHref(versionId, "../elsewhere")).toThrow();
  });
});
