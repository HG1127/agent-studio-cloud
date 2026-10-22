import { describe, expect, it } from "vitest";
import { AttentionListState, attentionHref, attentionStateFromSearch } from "@/features/runs/run-attention-url";
import { runReturnHref } from "@/features/runs/run-return-url";

const agentId = "00000000-0000-4000-8000-000000000052";
describe("待处理任务范围与安全返回", () => {
  it("默认第一页省略，三个页码独立，返回保留合法范围", () => {
    expect(attentionHref(AttentionListState.parse({}))).toBe("/runs/attention");
    const href = attentionHref(AttentionListState.parse({ agentId, sourceType: "manual", approvalPage: 2, eventPage: 3, failedPage: 4 }));
    expect(href).toBe(`/runs/attention?source=manual&agent=${agentId}&approvalPage=2&eventPage=3&failedPage=4`);
    expect(runReturnHref(href)).toBe(href);
    expect(runReturnHref("/runs/attention?agent=&source=")).toBe("/runs/attention");
  });
  it("页面页码有安全上限，非法过滤条件保留为错误而非默认为全部", () => {
    const parsed = attentionStateFromSearch({ approvalPage: "99999", eventPage: "-1", failedPage: "NaN" });
    expect(parsed.success && parsed.data).toEqual({ approvalPage: 10000, eventPage: 1, failedPage: 1 });
    expect(attentionStateFromSearch({ source: "invalid" }).success).toBe(false);
    expect(attentionStateFromSearch({ agent: "invalid" }).success).toBe(false);
  });
  it.each([
    "https://outside.example/runs/attention", "//outside.example/runs/attention",
    "/runs/attention#attention-approval", "/runs/attention?source=invalid",
    "/runs/attention?agent=invalid", "/runs/attention?status=failed",
    "/runs/attention?unknown=1", "/runs/attention?source=manual&source=schedule",
    "/runs/attention?approvalPage=2&approvalPage=3", "/runs/attention?approvalPage=0",
    "/runs/attention?eventPage=1.5", "/runs/attention?failedPage=-1",
    "/runs/attention?failedPage=10001", "/runs/attention?approvalPage=",
    "/runs/attention/../agents", "/runs/attention?source=manual#outside",
  ])("不接受非白名单返回地址 %s", (href) => {
    expect(runReturnHref(href)).toBe("/runs");
  });
});
