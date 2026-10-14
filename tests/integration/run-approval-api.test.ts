import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
const resume = vi.hoisted(() => vi.fn());
vi.mock("workflow/api", () => ({ resumeHook: resume }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
import { GET as list } from "@/app/api/runs/[runId]/approvals/route";
import { GET, POST } from "@/app/api/runs/[runId]/approvals/[approvalId]/route";
import { RunApprovalGetResult, RunApprovalListResult } from "@/contracts/run-approval";
import { approvals, runs, traceEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";

const createdRuns: string[] = [];
const ORIGIN = "http://localhost";
afterEach(async () => {
  if (createdRuns.length) {
    await db.delete(traceEvents).where(inArray(traceEvents.runId, createdRuns));
    await db.delete(approvals).where(inArray(approvals.runId, createdRuns));
    await db.delete(runs).where(inArray(runs.id, createdRuns));
  }
  createdRuns.length = 0; resume.mockReset(); vi.restoreAllMocks();
});
async function fixture(workspaceId = DEMO_WORKSPACE_ID) {
  const runId = randomUUID(); createdRuns.push(runId);
  await db.insert(runs).values({ id: runId, workspaceId, createdBy: DEMO_USER_ID, agentId: randomUUID(), versionId: randomUUID(), status: "waiting_approval", input: {} });
  const [approval] = await db.insert(approvals).values({ runId, workspaceId, createdBy: DEMO_USER_ID, nodeId: "confirm", nodeTitle: "核对金额", role: "负责人", reason: "核对后交付", payload: { review: { sourceNodeId: "extract", sourceTitle: "成果", format: "json", content: JSON.stringify({ amount: 0, approved: false, contact: "finance@example.com", credentials: { apiKey: "private-credential" } }) } } }).returning();
  return { runId, approvalId: approval.id, approval };
}
const context = (runId: string, approvalId: string) => ({ params: Promise.resolve({ runId, approvalId }) });
const url = (runId: string, approvalId: string) => `${ORIGIN}/api/runs/${runId}/approvals/${approvalId}`;
function decision(runId: string, approvalId: string, note = "已核对") {
  return POST(new Request(url(runId, approvalId), { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ confirmed: true, decision: "approved", note }) }), context(runId, approvalId));
}
describe("真实数据库程序化审批的隔离、防重与微秒翻页", () => {
  it("完整成果读取保留业务字段并隐藏凭据，摘要不批量取成果", async () => {
    const { runId, approvalId } = await fixture();
    const response = await GET(new Request(url(runId, approvalId)), context(runId, approvalId));
    const result = RunApprovalGetResult.parse(await response.json());
    expect(response.status).toBe(200); if (!result.ok) throw new Error(result.error);
    expect(JSON.parse(result.approval.review!.content)).toMatchObject({ amount: 0, approved: false, contact: "finance@example.com" });
    expect(JSON.stringify(result)).not.toContain("private-credential");
    const summary = await list(new Request(`${ORIGIN}/api/runs/${runId}/approvals`), { params: Promise.resolve({ runId }) });
    expect(RunApprovalListResult.parse(await summary.json())).toMatchObject({ ok: true, items: [{ id: approvalId, state: "pending" }] });
  });
  it("并发相同决定只保存一次，重复找回不改时间，不同备注明确冲突", async () => {
    const { runId, approvalId } = await fixture(); resume.mockResolvedValue(undefined);
    const results = await Promise.all([decision(runId, approvalId), decision(runId, approvalId)]);
    expect(results.every((result) => result.status === 200)).toBe(true);
    const [before] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect((await decision(runId, approvalId)).status).toBe(200);
    expect((await decision(runId, approvalId, "另一备注")).status).toBe(409);
    const [after] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(after.note).toBe("已核对"); expect(after.decidedAt?.getTime()).toBe(before.decidedAt?.getTime());
  });
  it("仅同工作区和原任务可以读取或决定，坏快照不会盲批", async () => {
    const own = await fixture(); const foreign = await fixture(randomUUID());
    expect((await GET(new Request(url(foreign.runId, foreign.approvalId)), context(foreign.runId, foreign.approvalId))).status).toBe(404);
    expect((await GET(new Request(url(own.runId, foreign.approvalId)), context(own.runId, foreign.approvalId))).status).toBe(404);
    expect((await decision(foreign.runId, foreign.approvalId)).status).toBe(409);
    await db.update(approvals).set({ payload: { review: { format: "json", content: "bad" } } }).where(eq(approvals.id, own.approvalId));
    expect((await GET(new Request(url(own.runId, own.approvalId)), context(own.runId, own.approvalId))).status).toBe(409);
    expect((await decision(own.runId, own.approvalId)).status).toBe(409); expect(resume).not.toHaveBeenCalled();
  });
  it("并发不同备注只有获胜请求被接受，不替另一请求声明成功", async () => {
    const { runId, approvalId } = await fixture(); resume.mockResolvedValue(undefined);
    const results = await Promise.all([decision(runId, approvalId, "甲方核对"), decision(runId, approvalId, "乙方核对")]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    const [saved] = await db.select().from(approvals).where(eq(approvals.id, approvalId));
    expect(saved.note).toBe(results[0].status === 200 ? "甲方核对" : "乙方核对");
  });
  it("原审批已消费而运行等待下一项时，旧请求找回，不恢复旧 Hook", async () => {
    const { runId, approvalId } = await fixture();
    await db.update(approvals).set({ status: "approved", note: "已核对", decidedAt: new Date() }).where(eq(approvals.id, approvalId));
    await db.insert(traceEvents).values({ runId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, seq: 1, kind: "approval.decided", title: "已确认", data: { _dedupeKey: `approval-decided:${approvalId}:approved` } });
    expect((await decision(runId, approvalId)).status).toBe(200); expect(resume).not.toHaveBeenCalled();
    const result = RunApprovalGetResult.parse(await (await GET(new Request(url(runId, approvalId)), context(runId, approvalId))).json());
    expect(result).toMatchObject({ ok: true, approval: { state: "processed", decisionConsumed: true, runStatus: "waiting_approval" } });
  });
  it("尚未确认恢复返回503保留决定；取消后的未消费决定不再恢复", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { runId, approvalId } = await fixture(); resume.mockRejectedValue(new Error("response lost"));
    const response = await decision(runId, approvalId); expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, saved: true, retryable: true });
    const [saved] = await db.select().from(approvals).where(eq(approvals.id, approvalId)); expect(saved.status).toBe("approved");
    resume.mockClear(); await db.update(runs).set({ status: "cancelled" }).where(eq(runs.id, runId));
    expect((await decision(runId, approvalId)).status).toBe(409); expect(resume).not.toHaveBeenCalled();
  });
  it("同毫秒不同微秒和同时间双标识翻页不遗漏，新增记录不挤入旧页", async () => {
    const { runId, approvalId } = await fixture();
    const ids = [approvalId, randomUUID(), randomUUID()];
    await db.update(approvals).set({ createdAt: sql`TIMESTAMPTZ '2000-01-01 00:00:00.123456+00'` }).where(eq(approvals.id, approvalId));
    for (const [index, id] of ids.slice(1).entries()) await db.insert(approvals).values({ id, runId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, nodeId: "more", nodeTitle: "另一项核对", role: "负责人", reason: "核对", createdAt: index === 0 ? sql`TIMESTAMPTZ '2000-01-01 00:00:00.123456+00'` : sql`TIMESTAMPTZ '2000-01-01 00:00:00.123455+00'` });
    let cursor: { createdAt: string; id: string } | null = null; const found: string[] = [];
    do {
      const query = cursor ? `&before=${encodeURIComponent(cursor.createdAt)}&beforeId=${cursor.id}` : "";
      const response = await list(new Request(`${ORIGIN}/api/runs/${runId}/approvals?limit=1${query}`), { params: Promise.resolve({ runId }) });
      const result = RunApprovalListResult.parse(await response.json()); if (!result.ok) throw new Error(result.error);
      found.push(...result.items.map((item) => item.id)); cursor = result.nextCursor;
      if (found.length === 1) await db.insert(approvals).values({ runId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, nodeId: "new", nodeTitle: "后来新增", role: "负责人", reason: "核对" });
    } while (cursor);
    expect(found).toHaveLength(3); expect(new Set(found)).toEqual(new Set(ids));
    expect(await db.select().from(approvals).where(and(eq(approvals.runId, runId), eq(approvals.workspaceId, DEMO_WORKSPACE_ID)))).toHaveLength(4);
  });
});
