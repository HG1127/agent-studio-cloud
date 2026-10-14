import { describe, expect, it } from "vitest";
import { AttentionCursor, AttentionItem, AttentionListInput, AttentionListResult, attentionLinks } from "@/contracts/attention";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const runId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const item = { kind: "approval-pending", id, runId, agentId: null, agentName: null, agentNameTruncated: false,
  runStatus: "waiting_approval", title: "核对成果", titleTruncated: false, error: null, errorTruncated: false,
  createdAt: "2026-10-08T12:00:00.000123Z", summary: "请核对", links: attentionLinks("approval-pending", id, runId) };

describe("集中待处理共享契约", () => {
  it("默认20条、最多50条，标识归一化并完整保留微秒游标", () => {
    expect(AttentionListInput.parse({})).toEqual({ limit: 20 });
    expect(AttentionListInput.parse({ runId: runId.toUpperCase() }).runId).toBe(runId);
    expect(AttentionCursor.parse({ id: id.toUpperCase(), kind: "approval-pending", createdAt: item.createdAt })).toEqual({ id, kind: "approval-pending", createdAt: item.createdAt });
  });
  it.each([
    { limit: 0 }, { limit: 51 }, { limit: 1.5 }, { kind: "all" }, { workspaceId: id }, { runId: "bad" },
    { before: item.createdAt }, { beforeId: id }, { beforeKind: "run-failed" },
    { before: item.createdAt, beforeId: id }, { beforeId: id, beforeKind: "run-failed" },
  ])("拒绝未知、无界或不完整筛选 %j", (input) => { expect(AttentionListInput.safeParse(input).success).toBe(false); });
  it("严格拒绝业务正文与引擎凭据，不接受跳向别的任务的入口", () => {
    expect(AttentionItem.safeParse({ ...item, payload: { secret: "hidden" } }).success).toBe(false);
    expect(AttentionItem.safeParse({ ...item, hookToken: "hidden" }).success).toBe(false);
    expect(AttentionItem.safeParse({ ...item, links: { ...item.links, detail: `/api/runs/${id}/approvals/${id}` } }).success).toBe(false);
  });
  it("类别必须与任务状态、来源标识一致", () => {
    expect(AttentionItem.safeParse({ ...item, runStatus: "completed" }).success).toBe(false);
    expect(AttentionItem.safeParse({ ...item, kind: "run-failed", runStatus: "failed", links: attentionLinks("run-failed", id, runId) }).success).toBe(false);
    expect(AttentionItem.safeParse(item).success).toBe(true);
  });
  it("游标必须属于最后一条，跨来源同标识合法，同类别重复非法", () => {
    const other = { ...item, kind: "tool-operation", runStatus: "failed", links: attentionLinks("tool-operation", id, runId) };
    const result = { ok: true, items: [item, other], nextCursor: { id, kind: "tool-operation", createdAt: item.createdAt } };
    expect(AttentionListResult.safeParse(result).success).toBe(true);
    expect(AttentionListResult.safeParse({ ...result, items: [item, item] }).success).toBe(false);
    expect(AttentionListResult.safeParse({ ...result, nextCursor: { ...result.nextCursor, kind: "approval-pending" } }).success).toBe(false);
    expect(AttentionListResult.safeParse({ ...result, items: [] }).success).toBe(false);
  });
});
