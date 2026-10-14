import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { POST, GET as listCases } from "@/app/api/attention/cases/route";
import { GET as readCase } from "@/app/api/attention/cases/[caseId]/route";
import { AttentionListInput } from "@/contracts/attention";
import { AttentionCaseListInput, AttentionHandlingInput, AttentionHandlingResult } from "@/contracts/attention-handling";
import { AttentionReference } from "@/contracts/attention-reference";
import { approvals, attentionCases, runDeliveries, runs, toolOperations, traceEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { recordAttentionHandlingAction } from "@/server/actions/record-attention-handling";
import { listAttention } from "@/server/queries/attention";
import { getAttentionCase, listAttentionCases } from "@/server/queries/attention-cases";

const ownedRuns: string[] = [];
afterEach(async () => {
  if (ownedRuns.length) {
    await db.delete(attentionCases).where(inArray(attentionCases.runId, ownedRuns));
    await db.delete(toolOperations).where(inArray(toolOperations.sourceRunId, ownedRuns));
    await db.delete(runDeliveries).where(inArray(runDeliveries.runId, ownedRuns));
    await db.delete(approvals).where(inArray(approvals.runId, ownedRuns));
    await db.delete(traceEvents).where(inArray(traceEvents.runId, ownedRuns));
    await db.delete(runs).where(inArray(runs.id, ownedRuns));
  }
  ownedRuns.length = 0;
});
async function run(status = "failed", tenant = DEMO_WORKSPACE_ID) {
  const id = randomUUID(); ownedRuns.push(id);
  await db.insert(runs).values({ id, workspaceId: tenant, createdBy: DEMO_USER_ID, agentId: randomUUID(), versionId: randomUUID(), status, input: {}, finishedAt: status === "failed" ? new Date() : null });
  return id;
}
async function referenceFor(runId: string, kind = "run-failed", tenant = DEMO_WORKSPACE_ID) {
  const result = await listAttention(tenant, AttentionListInput.parse({ runId, kind }));
  if (!result.ok || !result.items[0]) throw new Error("fixture missing");
  const item = result.items[0];
  return AttentionReference.parse({ kind: item.kind, id: item.id, runId, occurrence: item.occurrence });
}
function input(reference: AttentionReference, action = "acknowledge", expectedRevision = 0, requestId = randomUUID(), reason = "已核对业务系统") {
  return AttentionHandlingInput.parse({ reference, action, expectedRevision, requestId, reason,
    ...(["close-resolved", "accept-failure"].includes(action) ? { confirmedReviewed: true } : {}), ...(action === "accept-failure" ? { confirmedNoRetry: true } : {}) });
}
async function saved(reference: AttentionReference) {
  const result = await recordAttentionHandlingAction(input(reference));
  if (!result.ok) throw new Error(result.error);
  return result.item;
}
describe("待处理持久记录真实数据库验收", () => {
  it("接手与追加备注持久防重，同请求改内容冲突，不改写失败任务", async () => {
    const id = await run(); const reference = await referenceFor(id); const action = input(reference);
    const first = await recordAttentionHandlingAction(action);
    expect(first).toMatchObject({ ok: true, item: { status: "in-progress", revision: 1, sourceState: "active" } });
    expect(await recordAttentionHandlingAction(action)).toEqual(first);
    expect(await recordAttentionHandlingAction({ ...action, reason: "换了决定" })).toMatchObject({ ok: false });
    expect(await recordAttentionHandlingAction(input(reference, "note", 1, randomUUID(), "apiKey=abc 密码：abc"))).toMatchObject({ ok: true, item: { revision: 2 } });
    const current = await listAttention(DEMO_WORKSPACE_ID, AttentionListInput.parse({ runId: id, handlingState: "in-progress" }));
    expect(current).toMatchObject({ ok: true, items: [{ handling: { revision: 2, entryCount: 2 } }] });
    if (!first.ok) throw new Error("missing");
    const detail = await getAttentionCase(DEMO_WORKSPACE_ID, first.item.id);
    expect(JSON.stringify(detail)).not.toMatch(/apiKey=abc|密码：abc|requestHash/);
    expect((await db.select().from(runs).where(eq(runs.id, id)))[0].status).toBe("failed");
  });
  it("并发同一请求仅追加一次，并发不同请求不能覆盖同一版本", async () => {
    const reference = await referenceFor(await run()); const action = input(reference);
    const repeat = await Promise.all([recordAttentionHandlingAction(action), recordAttentionHandlingAction(action)]);
    expect(repeat.every((value) => value.ok)).toBe(true);
    const attempts = await Promise.all([recordAttentionHandlingAction(input(reference, "note", 1)), recordAttentionHandlingAction(input(reference, "note", 1))]);
    expect(attempts.filter((value) => value.ok)).toHaveLength(1);
    const [row] = await db.select().from(attentionCases).where(eq(attentionCases.runId, reference.runId));
    expect(row.revision).toBe(2); expect(row.entries).toHaveLength(2);
  });
  it("活跃审批不能关闭，拒绝不留下空记录，原入口解决后旧记录可关闭", async () => {
    const runId = await run("waiting_approval"); const approval = randomUUID();
    await db.insert(approvals).values({ id: approval, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, runId, nodeId: "confirm", nodeTitle: "核对成果", role: "负责人", reason: "核对", status: "pending", payload: {} });
    const reference = await referenceFor(runId, "approval-pending");
    expect(await recordAttentionHandlingAction(input(reference, "close-resolved"))).toMatchObject({ ok: false });
    expect(await db.select().from(attentionCases).where(eq(attentionCases.runId, runId))).toEqual([]);
    const record = await saved(reference);
    await db.update(runs).set({ status: "completed" }).where(eq(runs.id, runId));
    expect(await recordAttentionHandlingAction(input(reference, "close-resolved", record.revision))).toMatchObject({ ok: true, item: { status: "closed", sourceState: "inactive" } });
  });
  it("失败任务仅可明确接受失败关闭，记录关闭不伪报执行成功，也可明确重开", async () => {
    const id = await run(); const reference = await referenceFor(id);
    const accepted = await recordAttentionHandlingAction(input(reference, "accept-failure"));
    expect(accepted).toMatchObject({ ok: true, item: { status: "closed", sourceState: "active" } });
    expect(await listAttention(DEMO_WORKSPACE_ID, AttentionListInput.parse({ runId: id, handlingState: "closed" }))).toMatchObject({ ok: true, items: [{ runStatus: "failed" }] });
    expect(await recordAttentionHandlingAction(input(reference, "reopen", 1))).toMatchObject({ ok: true, item: { status: "in-progress", revision: 2, closedAt: null } });
    expect((await db.select().from(runs).where(eq(runs.id, id)))[0].status).toBe("failed");
  });
  it("新一轮等待使用新状态标记，旧关闭不隐藏新等待，也不复用原请求到新事项", async () => {
    const id = await run("waiting_event");
    await db.insert(traceEvents).values({ runId: id, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, seq: 1, nodeId: "wait", kind: "wait.started", title: "等待", data: { eventKey: "first.ready" } });
    const old = await referenceFor(id, "wait-event"); const record = await saved(old);
    await db.insert(traceEvents).values({ runId: id, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, seq: 2, nodeId: "wait", kind: "wait.started", title: "等待", data: { eventKey: "second.ready" } });
    const next = await referenceFor(id, "wait-event"); expect(next.occurrence).not.toBe(old.occurrence);
    expect(await recordAttentionHandlingAction(input(old, "close-resolved", record.revision))).toMatchObject({ ok: true, item: { status: "closed", sourceState: "changed" } });
    expect(await listAttention(DEMO_WORKSPACE_ID, AttentionListInput.parse({ runId: id, handlingState: "open" }))).toMatchObject({ ok: true, items: [{ occurrence: next.occurrence, handling: { caseId: null, revision: 0 } }] });
    expect(await recordAttentionHandlingAction(input(old))).toMatchObject({ ok: false });
  });
  it("外工作区来源、处理记录、伪造状态标记与任务归属均不能跨域处理", async () => {
    const tenant = randomUUID(); const foreignId = await run("failed", tenant); const foreign = await referenceFor(foreignId, "run-failed", tenant);
    expect(await recordAttentionHandlingAction(input(foreign))).toMatchObject({ ok: false });
    const own = await referenceFor(await run());
    expect(await recordAttentionHandlingAction(input({ ...own, occurrence: "forged" }))).toMatchObject({ ok: false });
    const ownCase = await saved(own);
    expect(await getAttentionCase(tenant, ownCase.id)).toBeNull();
    expect((await listAttentionCases(tenant, AttentionCaseListInput.parse({}))).items).toEqual([]);
  });
  it("处理历史保留微秒游标，筛选先于分页，摘要不携带正文或请求指纹", async () => {
    const ids = [await run(), await run(), await run()]; const records = [];
    for (const id of ids) records.push(await saved(await referenceFor(id)));
    const all = records.map((row) => row.id);
    for (const [index, record] of records.entries()) await db.update(attentionCases).set({ createdAt: sql`${index === 0 ? "2000-01-01T12:00:00.000456Z" : "2000-01-01T12:00:00.000123Z"}::timestamptz` }).where(eq(attentionCases.id, record.id));
    const first = await listAttentionCases(DEMO_WORKSPACE_ID, AttentionCaseListInput.parse({ runId: ids[0], limit: 1 }));
    expect(first.items[0].createdAt).toContain(".000456Z"); expect(first.nextCursor).toBeNull();
    const page = await listAttentionCases(DEMO_WORKSPACE_ID, AttentionCaseListInput.parse({ limit: 1, before: "2000-01-01T12:00:01.000000Z", beforeId: "ffffffff-ffff-4fff-8fff-ffffffffffff" }));
    expect(page.items).toHaveLength(1); expect(all).toContain(page.items[0].id);
    expect(JSON.stringify(page)).not.toMatch(/entries|requestHash|已核对业务系统/);
    const next = await listAttentionCases(DEMO_WORKSPACE_ID, AttentionCaseListInput.parse({ limit: 2, before: page.nextCursor!.createdAt, beforeId: page.nextCursor!.id }));
    expect(new Set([...page.items, ...next.items].map((row) => row.id))).toEqual(new Set(all));
  });
  it("真实 HTTP 接手、重复提交、详情与历史贯通，缓存与跨站读取受限", async () => {
    const id = await run(); const reference = await referenceFor(id); const action = input(reference);
    const send = () => POST(new Request("http://localhost/api/attention/cases", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(action) }));
    const response = await send(); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    const result = AttentionHandlingResult.parse(await response.json()); if (!result.ok) throw new Error(result.error);
    expect(await (await send()).json()).toEqual(result);
    expect((await readCase(new Request(`http://localhost/api/attention/cases/${result.item.id}`), { params: Promise.resolve({ caseId: result.item.id }) })).status).toBe(200);
    expect(await (await listCases(new Request(`http://localhost/api/attention/cases?runId=${id}`))).json()).toMatchObject({ ok: true, items: [{ id: result.item.id }] });
    expect((await readCase(new Request(`http://localhost/api/attention/cases/${result.item.id}`, { headers: { origin: "https://other.example" } }), { params: Promise.resolve({ caseId: result.item.id }) })).status).toBe(403);
  });
  it.each(["pending", "blocked"] as const)("%s 业务操作阻止接受失败关闭，不明副作用不因确认勾选而消失", async (status) => {
    const id = await run(); const reference = await referenceFor(id); const operationId = randomUUID();
    await db.insert(toolOperations).values({ id: operationId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, sourceRunId: id, nodeTitle: "登记订单", toolId: "fixture", action: "record", keyHash: randomUUID(), requestHash: randomUUID(), status });
    const action = input(reference, "accept-failure");
    expect(await recordAttentionHandlingAction(action)).toMatchObject({ ok: false });
    expect(await db.select().from(attentionCases).where(eq(attentionCases.runId, id))).toEqual([]);
    await db.update(toolOperations).set({ status: "completed" }).where(eq(toolOperations.id, operationId));
    expect(await recordAttentionHandlingAction(action)).toMatchObject({ ok: true, item: { status: "closed" } });
  });
  it("待核对工具离开清单仍须取得有效回执，不能将重试或坏完成记录当作已解决", async () => {
    const runId = await run(); const id = randomUUID();
    await db.insert(toolOperations).values({ id, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, sourceRunId: runId, nodeTitle: "登记订单", toolId: "fixture", action: "record", keyHash: randomUUID(), requestHash: randomUUID(), status: "blocked" });
    const reference = await referenceFor(runId, "tool-operation"); const record = await saved(reference);
    const close = input(reference, "close-resolved", record.revision);
    await db.update(toolOperations).set({ status: "pending" }).where(eq(toolOperations.id, id));
    expect(await recordAttentionHandlingAction(close)).toMatchObject({ ok: false });
    await db.update(toolOperations).set({ status: "completed", receipt: null }).where(eq(toolOperations.id, id));
    expect(await recordAttentionHandlingAction(close)).toMatchObject({ ok: false });
    await db.update(toolOperations).set({ receipt: { receiptId: "actual-order", amount: 0, approved: false } }).where(eq(toolOperations.id, id));
    expect(await recordAttentionHandlingAction(close)).toMatchObject({ ok: true, item: { status: "closed", sourceState: "inactive" } });
    expect((await db.select().from(toolOperations).where(eq(toolOperations.id, id)))[0].receipt).toEqual({ receiptId: "actual-order", amount: 0, approved: false });
  });
  it("投递关闭必须匹配原接收回执和接收时间，不接受其他投递的回执", async () => {
    const runId = await run("completed"); const id = randomUUID();
    await db.insert(runDeliveries).values({ id, runId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, targetId: "fixture", targetHash: "a".repeat(64), retentionMs: 600000, status: "failed" });
    const reference = await referenceFor(runId, "delivery-failed"); const record = await saved(reference);
    const close = input(reference, "close-resolved", record.revision);
    await db.update(runDeliveries).set({ status: "delivered", deliveredAt: null, receipt: { ok: true, deliveryId: id } }).where(eq(runDeliveries.id, id));
    expect(await recordAttentionHandlingAction(close)).toMatchObject({ ok: false });
    await db.update(runDeliveries).set({ deliveredAt: new Date(), receipt: { ok: true, deliveryId: randomUUID() } }).where(eq(runDeliveries.id, id));
    expect(await recordAttentionHandlingAction(close)).toMatchObject({ ok: false });
    await db.update(runDeliveries).set({ receipt: { ok: true, deliveryId: id, receiptId: "confirmed" } }).where(eq(runDeliveries.id, id));
    expect(await recordAttentionHandlingAction(close)).toMatchObject({ ok: true, item: { status: "closed", sourceState: "inactive" } });
  });
  it("补投后再次失败即使更新时间相同也使用新标记，旧关闭不隐藏新失败", async () => {
    const runId = await run("completed"); const id = randomUUID(); const stamp = new Date("2026-10-09T00:00:00Z");
    await db.insert(runDeliveries).values({ id, runId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, targetId: "fixture", targetHash: "a".repeat(64), retentionMs: 600000, status: "failed", updatedAt: stamp });
    const reference = await referenceFor(runId, "delivery-failed"); const record = await saved(reference);
    await db.update(runDeliveries).set({ status: "pending" }).where(eq(runDeliveries.id, id));
    expect(await recordAttentionHandlingAction(input(reference, "close-resolved", record.revision))).toMatchObject({ ok: false });
    const resolution = { requestId: randomUUID(), requestHash: "b".repeat(64), reason: "private-delivery-reason", createdBy: DEMO_USER_ID, createdAt: stamp.toISOString() };
    await db.update(runDeliveries).set({ status: "failed", updatedAt: stamp, attempts: 1, resolutions: [resolution] }).where(eq(runDeliveries.id, id));
    const next = await referenceFor(runId, "delivery-failed"); expect(next.occurrence).not.toBe(reference.occurrence);
    expect(await recordAttentionHandlingAction(input(reference, "close-resolved", record.revision))).toMatchObject({ ok: true, item: { status: "closed", sourceState: "changed" } });
    const page = await listAttention(DEMO_WORKSPACE_ID, AttentionListInput.parse({ runId, handlingState: "open" }));
    expect(page).toMatchObject({ ok: true, items: [{ occurrence: next.occurrence, handling: { caseId: null } }] });
    expect(JSON.stringify(page)).not.toContain("private-delivery-reason");
  });
});
