import { describe, expect, it } from "vitest";
import { ToolOperationListInput } from "@/contracts/tool-operation";
import { toolOperationReturnFilters, toolOperationReturnHref, toolOperationRunHref, toolOperationsHref } from "@/features/tool-operations/tool-operation-navigation";
import { runReturnHref } from "@/features/runs/run-return-url";
import { collaborationNavigation } from "@/features/runs/run-collaboration-navigation";

const runId = "00000000-0000-4000-8000-0000000000ab";
const otherRunId = "00000000-0000-4000-8000-0000000000ac";
const cursorId = "00000000-0000-4000-8000-0000000000ad";

describe("工具核对的安全任务往返", () => {
  it("真实契约筛选与配对游标往返保留微秒，不伪造页码", () => {
    const filters = ToolOperationListInput.parse({ sourceRunId: runId, status: "blocked", limit: 3, before: "2026-10-09T00:00:00.123456Z", beforeId: cursorId });
    const href = toolOperationsHref(filters);
    expect(toolOperationReturnFilters(href)).toEqual(filters);
    expect(runReturnHref(href)).toBe(href);
    const task = new URL(toolOperationRunHref(runId, filters), "https://test.invalid");
    expect(task.pathname).toBe("/runs/" + runId);
    expect(task.searchParams.get("from")).toBe(href);
    expect(collaborationNavigation({ from: href }).backHref).toBe(href);
    expect(href).not.toContain("page=");
  });
  it("全部记录和状态筛选可返回，默认每批数量不需要显示内部参数", () => {
    expect(toolOperationsHref({ limit: 20 })).toBe("/tool-operations");
    expect(toolOperationReturnHref("/tool-operations?status=blocked", runId)).toBe("/tool-operations?status=blocked");
    expect(toolOperationReturnFilters("/tool-operations")).toEqual({ limit: 20 });
  });
  it("大小写只作标识规范化，来源范围必须与实际任务一致", () => {
    const href = "/tool-operations?sourceRunId=" + runId.toUpperCase();
    expect(toolOperationReturnHref(href, runId)).toBe("/tool-operations?sourceRunId=" + runId);
    expect(toolOperationReturnHref(href, otherRunId)).toBeNull();
    expect(() => toolOperationRunHref(otherRunId, { sourceRunId: runId, limit: 20 })).toThrow("Source task");
  });
  it.each([
    undefined, "", "https://external.invalid/tool-operations", "//external.invalid/tool-operations", "javascript:alert(1)",
    "/tool-operations/extra", "/tool-operations-other", "/tool-operations#history", "/tool-operations?status=unknown",
    "/tool-operations?status=blocked&status=blocked", "/tool-operations?agent=" + runId, "/tool-operations?sourceType=manual",
    "/tool-operations?__proto__=hidden", "/tool-operations?constructor=hidden",
    "/tool-operations?sourceRunId=private", "/tool-operations?limit=0", "/tool-operations?limit=51",
    "/tool-operations?before=2026-10-09T00%3A00%3A00.000Z", "/tool-operations?beforeId=" + cursorId,
    "/tool-operations?unknown=" + "x".repeat(600),
  ])("无效、跨站、重复或后端不支持的范围不能用作返回地址 %#", (raw) => {
    expect(toolOperationReturnHref(raw)).toBeNull();
    expect(runReturnHref(raw)).toBe("/runs");
  });
});
