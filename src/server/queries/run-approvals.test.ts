import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rows: [] as unknown[][], fields: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { select: (fields: unknown) => {
  mocks.fields(fields);
  const query = { from: () => query, innerJoin: () => query, where: () => query, orderBy: () => query, limit: async (value: number) => { mocks.limit(value); return mocks.rows.shift() ?? []; } };
  return query;
} } }));
import { getRunApproval, listRunApprovals } from "./run-approvals";
const RUN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WORKSPACE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const createdAt = new Date("2000-01-01T00:00:00Z");
const approval = { id: ID, runId: RUN, nodeId: "confirm", nodeTitle: "核对成果", status: "pending", role: "负责人", reason: "核对后交付", payload: { review: null }, note: null, decidedAt: null, createdAt };
beforeEach(() => { mocks.rows = []; mocks.fields.mockReset(); mocks.limit.mockReset(); });
describe("审批读取的有界投影与完整成果", () => {
  it("坏快照明确不可用，不转成空成果", async () => {
    mocks.rows = [[{ approval: { ...approval, payload: { review: { content: "bad" } } }, runStatus: "waiting_approval", consumed: false }]];
    expect(await getRunApproval(RUN, ID, WORKSPACE)).toEqual({ kind: "unavailable" });
  });
  it("深层结构化业务字段完整保留，凭据及标题秘密隐藏，且不更改原快照", async () => {
    let nested: Record<string, unknown> = { amount: 0, approved: false, apiKey: "private-deep-key" };
    for (let index = 0; index < 26; index++) nested = { nested };
    const value = { deep: nested, contact: "finance@example.com" };
    const review = { sourceNodeId: "extract", sourceTitle: "secret=private-source-title", content: JSON.stringify(value), format: "json" };
    mocks.rows = [[{ approval: { ...approval, payload: { review } }, runStatus: "waiting_approval", consumed: false }]];
    const result = await getRunApproval(RUN, ID, WORKSPACE);
    expect(result.kind).toBe("found"); if (result.kind !== "found") throw new Error("读取失败");
    const content = result.approval.review!.content;
    expect(content).toContain('"amount":0'); expect(content).toContain('"approved":false'); expect(content).toContain("finance@example.com");
    expect(JSON.stringify(result)).not.toContain("private-deep-key"); expect(JSON.stringify(result)).not.toContain("private-source-title");
    expect(review.content).toContain("private-deep-key");
  });
  it("旧空快照保持兼容，已消费旧决定正确显示无需继续", async () => {
    mocks.rows = [[{ approval: { ...approval, status: "approved", payload: null }, runStatus: "waiting_approval", consumed: true }]];
    expect(await getRunApproval(RUN, ID, WORKSPACE)).toMatchObject({ kind: "found", approval: { review: null, state: "processed", decisionConsumed: true } });
  });
  it("列表只查询必要摘要，多读一条确定翻页，标题截断明确且保留微秒", async () => {
    const row = { id: ID, runId: RUN, nodeTitle: "😀".repeat(500), titleTruncated: false, status: "pending", createdAt, decidedAt: null, decisionConsumed: false, cursorCreatedAt: "2000-01-01T00:00:00.123456Z" };
    mocks.rows = [[{ status: "waiting_approval" }], [row, { ...row, id: WORKSPACE }]];
    const result = await listRunApprovals(RUN, WORKSPACE, { limit: 1 });
    expect(result).toMatchObject({ ok: true, items: [{ titleTruncated: true }], nextCursor: { createdAt: row.cursorCreatedAt, id: ID } });
    expect(mocks.limit.mock.calls).toEqual([[1], [2]]);
    expect(Object.keys(mocks.fields.mock.calls[1][0])).not.toContain("payload"); expect(Object.keys(mocks.fields.mock.calls[1][0])).not.toContain("note");
  });
  it("不存在的任务不继续读取审批列表", async () => {
    mocks.rows = [[]];
    expect(await listRunApprovals(RUN, WORKSPACE, { limit: 20 })).toBeNull(); expect(mocks.fields).toHaveBeenCalledOnce();
  });
});
