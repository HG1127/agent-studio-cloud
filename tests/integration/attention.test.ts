import { createHash, randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/attention/route";
import { AttentionListInput, AttentionListResult, type AttentionCursor } from "@/contracts/attention";
import type { RunStatus } from "@/contracts/run";
import { agents, approvals, runDeliveries, runs, toolOperations, traceEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { listAttention } from "@/server/queries/attention";

let workspace: string;
const ownedRuns: string[] = [];
const ownedAgents: string[] = [];
const ownedOperations: string[] = [];
const ownedDeliveries: string[] = [];
beforeEach(() => { workspace = randomUUID(); });
afterEach(async () => {
  if (ownedRuns.length) {
    await db.delete(traceEvents).where(inArray(traceEvents.runId, ownedRuns));
    await db.delete(approvals).where(inArray(approvals.runId, ownedRuns));
  }
  if (ownedOperations.length) await db.delete(toolOperations).where(inArray(toolOperations.id, ownedOperations));
  if (ownedDeliveries.length) await db.delete(runDeliveries).where(inArray(runDeliveries.id, ownedDeliveries));
  if (ownedRuns.length) await db.delete(runs).where(inArray(runs.id, ownedRuns));
  if (ownedAgents.length) await db.delete(agents).where(inArray(agents.id, ownedAgents));
  ownedRuns.length = ownedAgents.length = ownedOperations.length = ownedDeliveries.length = 0;
});
const timestamp = "2000-01-01T12:00:00.000123Z";
async function makeRun(status: RunStatus, tenant = workspace, createdAt = timestamp) {
  const agentId = randomUUID(); const id = randomUUID();
  ownedAgents.push(agentId); ownedRuns.push(id);
  await db.insert(agents).values({ id: agentId, workspaceId: tenant, createdBy: DEMO_USER_ID, name: "业务助手", intentText: "集中处理验收" });
  await db.insert(runs).values({ id, agentId, versionId: randomUUID(), workspaceId: tenant, createdBy: DEMO_USER_ID, status,
    input: { privateInput: "private-input-body" }, context: { privateContext: "private-context-body" }, result: { privateResult: "private-result-body" },
    workflowRunId: "private-workflow-handle", error: "apiKey=private-run-error", createdAt: sql`${createdAt}::timestamptz` });
  return { id, agentId, workspaceId: tenant };
}
type Fixture = Awaited<ReturnType<typeof makeRun>>;
async function makeApproval(run: Fixture, status = "pending", id = randomUUID(), createdAt = timestamp) {
  await db.insert(approvals).values({ id, runId: run.id, workspaceId: run.workspaceId, createdBy: DEMO_USER_ID,
    nodeId: "confirm", nodeTitle: "核对业务成果", role: "负责人", reason: "private-approval-reason", note: "private-approval-note", status,
    payload: { privateBody: "private-approval-body", hookToken: "private-hook-token" }, createdAt: sql`${createdAt}::timestamptz` });
  return id;
}
async function makeOperation(run: Fixture, id = randomUUID(), createdAt = timestamp) {
  const hash = createHash("sha256").update(randomUUID()).digest("hex"); ownedOperations.push(id);
  await db.insert(toolOperations).values({ id, workspaceId: run.workspaceId, createdBy: DEMO_USER_ID, sourceRunId: run.id,
    nodeTitle: "登记业务订单", toolId: "private-tool-id", action: "record", keyHash: hash, requestHash: hash, status: "blocked",
    error: "apiKey=private-tool-error", receipt: { privateReceipt: "private-receipt-body" }, leaseOwner: randomUUID(),
    retryDeadline: new Date("2000-01-02T00:00:00Z"), createdAt: sql`${createdAt}::timestamptz` });
  return id;
}
async function makeDelivery(run: Fixture, id = randomUUID(), createdAt = timestamp) {
  ownedDeliveries.push(id);
  await db.insert(runDeliveries).values({ id, workspaceId: run.workspaceId, createdBy: DEMO_USER_ID, runId: run.id,
    targetId: "private-target-id", targetHash: "a".repeat(64), retentionMs: 600000, status: "failed", error: "apiKey=private-delivery-error",
    payload: sql`${JSON.stringify({ privateBody: "private-delivery-body" })}::jsonb`, workflowRunId: "private-delivery-handle", createdAt: sql`${createdAt}::timestamptz` });
  return id;
}
async function page(input: Record<string, unknown> = {}, tenant = workspace) {
  const result = await listAttention(tenant, AttentionListInput.parse(input));
  if (!result.ok) throw new Error(result.error);
  return result;
}

describe("集中待处理真实数据库验收", () => {
  it("六类来源统一返回必要摘要，不批量读取业务正文、秘密或内部句柄", async () => {
    const awaiting = await makeRun("waiting_approval");
    const pending = await makeApproval(awaiting); const resume = await makeApproval(awaiting, "approved");
    const event = await makeRun("waiting_event"); const failure = await makeRun("failed"); const completed = await makeRun("completed");
    const operation = await makeOperation(completed); const delivery = await makeDelivery(completed);
    const result = await page();
    expect(result.items.map((item) => `${item.kind}:${item.id}`).sort()).toEqual([
      `approval-pending:${pending}`, `approval-resume:${resume}`, `wait-event:${event.id}`, `run-failed:${failure.id}`,
      `tool-operation:${operation}`, `delivery-failed:${delivery}`,
    ].sort());
    expect(result.items).toHaveLength(6); expect(result.nextCursor).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/private-|payload|receipt|hookToken|workflowRunId|targetHash|resolutions/);
    expect(result.items.find((item) => item.id === delivery)?.runStatus).toBe("completed");
  });
  it("已消费旧决定和终态确认不进入待处理，恢复后立即排除原确认", async () => {
    const awaiting = await makeRun("waiting_approval"); const consumed = await makeApproval(awaiting, "approved");
    const pending = await makeApproval(awaiting);
    await db.insert(traceEvents).values({ runId: awaiting.id, workspaceId: workspace, createdBy: DEMO_USER_ID, seq: 1,
      kind: "approval.decided", title: "已确认", data: { _dedupeKey: `approval-decided:${consumed}:approved` } });
    for (const status of ["completed", "failed", "cancelled"] as const) await makeApproval(await makeRun(status), "approved");
    expect((await page({ runId: awaiting.id })).items.map((item) => item.id)).toEqual([pending]);
    await db.update(runs).set({ status: "running" }).where(eq(runs.id, awaiting.id));
    expect((await page({ runId: awaiting.id })).items).toEqual([]);
  });
  it("外工作区轨迹不能隐藏本工作区审批，关联错租户不能泄露助手或任务状态", async () => {
    const own = await makeRun("waiting_approval"); const id = await makeApproval(own, "rejected"); const foreign = await makeRun("failed", randomUUID());
    await makeOperation(foreign); await makeDelivery(foreign);
    await db.insert(traceEvents).values({ runId: own.id, workspaceId: foreign.workspaceId, createdBy: DEMO_USER_ID, seq: 1,
      kind: "approval.decided", title: "其他工作区", data: { _dedupeKey: `approval-decided:${id}:rejected` } });
    const orphan = await makeOperation({ ...foreign, workspaceId: workspace });
    const result = await page();
    expect(result.items).toHaveLength(2);
    expect(result.items.find((item) => item.id === id)?.kind).toBe("approval-resume");
    expect(result.items.find((item) => item.id === orphan)).toMatchObject({ agentId: null, agentName: null, runStatus: null });
    expect((await page({ agentId: foreign.agentId })).items).toEqual([]);
  });
  it("跨来源同标识、同时间和同毫秒不同微秒逐条翻页不遗漏、不重复", async () => {
    const awaiting = await makeRun("waiting_approval"); const shared = randomUUID();
    await makeApproval(awaiting, "pending", shared, "2000-01-01T12:00:00.000456Z");
    await makeOperation(awaiting, shared, "2000-01-01T12:00:00.000456Z");
    await makeDelivery(awaiting, shared, "2000-01-01T12:00:00.000456Z");
    await makeApproval(awaiting, "rejected", randomUUID(), timestamp);
    await makeOperation(awaiting, randomUUID(), timestamp);
    let cursor: AttentionCursor | null = null; const found: string[] = [];
    do {
      const result = await page({ runId: awaiting.id, limit: 1, ...(cursor ? { before: cursor.createdAt, beforeId: cursor.id, beforeKind: cursor.kind } : {}) });
      found.push(...result.items.map((item) => `${item.kind}:${item.id}`)); cursor = result.nextCursor;
      if (cursor) expect(cursor.createdAt).toMatch(/\.000(?:123|456)Z$/);
      if (found.length === 1) await makeApproval(awaiting, "pending", randomUUID(), "2000-01-01T12:01:00.000000Z");
      expect(found.length).toBeLessThanOrEqual(5);
    } while (cursor);
    expect(found).toHaveLength(5); expect(new Set(found).size).toBe(5);
    expect(found.filter((value) => value.endsWith(shared))).toHaveLength(3);
  });
  it("类别、助手及任务筛选在分页前生效，记录解决后不再列出", async () => {
    const target = await makeRun("completed"); const other = await makeRun("completed");
    const id = await makeOperation(target); await makeOperation(other); await makeDelivery(target);
    expect((await page({ kind: "tool-operation", agentId: target.agentId, limit: 1 })).items.map((item) => item.id)).toEqual([id]);
    expect((await page({ kind: "tool-operation", runId: target.id })).nextCursor).toBeNull();
    await db.update(toolOperations).set({ status: "completed" }).where(eq(toolOperations.id, id));
    expect((await page({ kind: "tool-operation", runId: target.id })).items).toEqual([]);
  });
  it("只列失败投递，已归档、已送达及正在重试的记录不混入人工异常清单", async () => {
    const run = await makeRun("completed"); const id = await makeDelivery(run);
    for (const status of ["pending", "queued", "sending", "delivered", "waiting_result"] as const) {
      await db.update(runDeliveries).set({ status }).where(eq(runDeliveries.id, id));
      expect((await page({ runId: run.id })).items).toEqual([]);
    }
    await db.update(runDeliveries).set({ status: "failed", archivedAt: new Date() }).where(eq(runDeliveries.id, id));
    expect((await page({ runId: run.id })).items).toEqual([]);
  });
  it("过长标签和错误显式标记截断，完整业务正文只在原详情读取", async () => {
    const run = await makeRun("waiting_approval"); const id = await makeApproval(run);
    await db.update(agents).set({ name: "助手".repeat(201) }).where(eq(agents.id, run.agentId));
    await db.update(approvals).set({ nodeTitle: "成果".repeat(501) }).where(eq(approvals.id, id));
    const operation = await makeOperation(run);
    await db.update(toolOperations).set({ error: "失败".repeat(2001) }).where(eq(toolOperations.id, operation));
    const result = await page({ runId: run.id });
    expect(result.items.find((item) => item.id === id)).toMatchObject({ titleTruncated: true, agentNameTruncated: true });
    expect(result.items.find((item) => item.id === operation)).toMatchObject({ errorTruncated: true });
    expect(result.items.every((item) => item.title.length <= 500 && (item.error?.length ?? 0) <= 2000)).toBe(true);
  });
  it("真实只读 HTTP 接口限定默认工作区，并允许已归档助手的历史异常被发现", async () => {
    const own = await makeRun("failed", DEMO_WORKSPACE_ID); const foreign = await makeRun("failed", randomUUID());
    await db.update(agents).set({ archivedAt: new Date() }).where(eq(agents.id, own.agentId));
    const response = await GET(new Request(`http://localhost/api/attention?runId=${own.id.toUpperCase()}`));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(AttentionListResult.parse(await response.json())).toMatchObject({ ok: true, items: [{ id: own.id, kind: "run-failed" }] });
    expect(await (await GET(new Request(`http://localhost/api/attention?runId=${foreign.id}`))).json()).toEqual({ ok: true, items: [], nextCursor: null });
  });
  it("Postgres 字符截取后较长表情符号元数据不会触发坏数据失败或拆开字符", async () => {
    const run = await makeRun("waiting_approval"); const id = await makeApproval(run);
    await db.update(agents).set({ name: "A" + "😀".repeat(200) }).where(eq(agents.id, run.agentId));
    await db.update(approvals).set({ nodeTitle: "A" + "😀".repeat(500) }).where(eq(approvals.id, id));
    const result = await page({ runId: run.id });
    expect(result.items[0]).toMatchObject({ title: "A" + "😀".repeat(249), agentName: "A" + "😀".repeat(99), titleTruncated: true, agentNameTruncated: true });
  });
  it("真实 SQL 摘要截掉私钥结束标记后，标签和错误仍不泄露凭据正文", async () => {
    const run = await makeRun("waiting_approval"); const id = await makeApproval(run); const operation = await makeOperation(run);
    const secret = "-----BEGIN PRIVATE KEY-----\n" + "private-fixture-key-material-".repeat(100) + "\n-----END PRIVATE KEY-----";
    await db.update(agents).set({ name: secret }).where(eq(agents.id, run.agentId));
    await db.update(approvals).set({ nodeTitle: secret }).where(eq(approvals.id, id));
    await db.update(toolOperations).set({ error: secret }).where(eq(toolOperations.id, operation));
    const result = await page({ runId: run.id });
    expect(JSON.stringify(result)).not.toContain("private-fixture-key-material");
    expect(result.items.find((item) => item.id === id)).toMatchObject({ titleTruncated: true, agentNameTruncated: true });
    expect(result.items.find((item) => item.id === operation)?.errorTruncated).toBe(true);
  });
});
