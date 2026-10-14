import { describe, expect, it } from "vitest";
import { AttentionHandlingHistory, AttentionHandlingInput, AttentionCaseListInput, AttentionHandlingSummary, AttentionCaseListResult, AttentionCaseView } from "@/contracts/attention-handling";
import { AttentionReference } from "@/contracts/attention-reference";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const reference = { kind: "run-failed", id, runId: id, occurrence: "saved:failure" };
const input = { reference, requestId: id, expectedRevision: 0, reason: "已核对", action: "accept-failure", confirmedReviewed: true, confirmedNoRetry: true };
describe("持久处理共享契约", () => {
  it("标识归一化，必须绑定本次来源且明确确认失败不再重试", () => {
    expect(AttentionHandlingInput.parse({ ...input, requestId: id.toUpperCase() }).requestId).toBe(id);
    expect(AttentionHandlingInput.safeParse({ ...input, confirmedNoRetry: false }).success).toBe(false);
    expect(AttentionHandlingInput.safeParse({ ...input, reference: { ...reference, occurrence: "" } }).success).toBe(false);
    expect(AttentionReference.safeParse({ ...reference, runId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }).success).toBe(false);
  });
  it.each([{ ...input, workspaceId: id }, { ...input, hookToken: "hidden" }, { ...input, expectedRevision: -1 }, { ...input, reason: " " }, { ...input, reason: "A".repeat(1001) }])("拒绝未知字段、无版本或无界原因", (value) => { expect(AttentionHandlingInput.safeParse(value).success).toBe(false); });
  it("历史请求标识不能重复或覆盖，历史与列表都有容量边界", () => {
    const entry = { requestId: id, action: "note", requestHash: "a".repeat(64), reason: "已核对", createdBy: id, createdAt: "2026-10-09T00:00:00Z" };
    expect(AttentionHandlingHistory.safeParse([entry, entry]).success).toBe(false);
    expect(AttentionHandlingHistory.safeParse(Array(101).fill(entry)).success).toBe(false);
    expect(AttentionCaseListInput.safeParse({ beforeId: id }).success).toBe(false);
    expect(AttentionCaseListInput.safeParse({ limit: 51 }).success).toBe(false);
    expect(AttentionHandlingSummary.safeParse({ caseId: null, status: "open", revision: 0, entryCount: 0, updatedAt: null, closedAt: null, entries: [entry] }).success).toBe(false);
  });
  it("公开详情拒绝私有指纹、重复历史和不一致的关闭状态", () => {
    const now = "2026-10-09T00:00:00Z";
    const entry = { requestId: id, action: "note", reason: "已核对", createdBy: id, createdAt: now };
    const item = { id, reference, title: "任务失败", status: "open", revision: 1, createdAt: now, updatedAt: now, closedAt: null, sourceState: "active", entries: [entry] };
    expect(AttentionCaseView.safeParse(item).success).toBe(true);
    expect(AttentionCaseView.safeParse({ ...item, entries: [{ ...entry, requestHash: "a".repeat(64) }] }).success).toBe(false);
    expect(AttentionCaseView.safeParse({ ...item, revision: 2, entries: [entry, entry] }).success).toBe(false);
    expect(AttentionCaseView.safeParse({ ...item, status: "closed" }).success).toBe(false);
    expect(AttentionHandlingSummary.safeParse({ caseId: id, status: "open", revision: 1, entryCount: 1, updatedAt: null, closedAt: null }).success).toBe(false);
  });
  it("历史游标必须对应最后一条记录，重复项与空页游标不能虚报成功", () => {
    const now = "2026-10-09T00:00:00.000123Z";
    const item = { id, reference, title: "任务失败", status: "open", revision: 1, entryCount: 1, createdAt: now, updatedAt: now, closedAt: null };
    const cursor = { createdAt: now, id };
    expect(AttentionCaseListResult.safeParse({ ok: true, items: [item], nextCursor: cursor }).success).toBe(true);
    expect(AttentionCaseListResult.safeParse({ ok: true, items: [], nextCursor: cursor }).success).toBe(false);
    expect(AttentionCaseListResult.safeParse({ ok: true, items: [item, item], nextCursor: null }).success).toBe(false);
    expect(AttentionCaseListResult.safeParse({ ok: true, items: [item], nextCursor: { ...cursor, createdAt: "2026-10-09T00:00:00.000456Z" } }).success).toBe(false);
  });
});
