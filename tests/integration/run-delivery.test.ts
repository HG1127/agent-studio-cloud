import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("workflow/api", () => ({ start: mocks.start }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
import { AgentManifest } from "@/contracts/manifest";
import { RunDeliveryEnvelope, RunDeliveryResult } from "@/contracts/run-delivery";
import { agents, agentVersions, runDeliveries, runs } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { attemptRunDeliveryCore, materializeRunDelivery } from "@/server/services/run-delivery";
import { dispatchPendingDeliveriesCore } from "@/server/services/dispatch-run-deliveries";
import { deliveryTargetBinding, parseDeliveryTargets } from "@/server/delivery/target-registry";
import { retryRunDeliveryAction } from "@/server/actions/retry-run-delivery";
import { startRunCore } from "@/server/services/start-run-core";
import { GET } from "@/app/api/runs/[runId]/delivery/route";

const target = { id: "delivery.test", revision: "1", endpoint: "https://receiver.test/results", idempotent: true, retentionMs: 600_000, headers: { Authorization: "Bearer private-receiver" } };
let runIds: string[] = [], agentIds: string[] = [], versionIds: string[] = [];
const binding = deliveryTargetBinding(parseDeliveryTargets(JSON.stringify([target]))[0]);
beforeEach(() => { vi.stubEnv("RUN_DELIVERY_TARGETS_JSON", JSON.stringify([target])); mocks.start.mockReset().mockResolvedValue({ runId: "workflow_delivery_test", cancel: vi.fn() }); vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  if (runIds.length) { await db.delete(runDeliveries).where(inArray(runDeliveries.runId, runIds)); await db.delete(runs).where(inArray(runs.id, runIds)); }
  if (versionIds.length) await db.delete(agentVersions).where(inArray(agentVersions.id, versionIds));
  if (agentIds.length) await db.delete(agents).where(inArray(agents.id, agentIds));
  runIds = []; agentIds = []; versionIds = [];
});
async function prepare(status = "completed", workspaceId = DEMO_WORKSPACE_ID, result: Record<string, unknown> = { amount: 0, approved: false, email: "buyer@example.com", apiKey: "private-business-key" }) {
  const [run] = await db.insert(runs).values({ workspaceId, createdBy: DEMO_USER_ID, agentId: randomUUID(), versionId: randomUUID(), status, result, input: { privateInput: "do-not-deliver" } }).returning();
  runIds.push(run.id);
  const [delivery] = await db.insert(runDeliveries).values({ workspaceId, createdBy: DEMO_USER_ID, runId: run.id, targetId: binding.targetId, targetHash: binding.targetHash, retentionMs: binding.retentionMs }).returning();
  return { run, delivery };
}
async function queued() {
  const fixture = await prepare();
  await materializeRunDelivery(fixture.delivery.id, DEMO_WORKSPACE_ID);
  const token = randomUUID();
  await db.update(runDeliveries).set({ status: "queued", leaseOwner: token, leaseExpiresAt: new Date(Date.now() + 120_000) }).where(eq(runDeliveries.id, fixture.delivery.id));
  return { ...fixture, token };
}
async function deliveryRow(id: string) { return (await db.select().from(runDeliveries).where(eq(runDeliveries.id, id)))[0]; }
const ack = (id: string, receiptId = "receipt-1") => Response.json({ ok: true, deliveryId: id, receiptId });
describe("持久成果投递事务与并发", () => {
  it("等待结果时不发送，终态并发冻结一次且不泄露输入或凭据", async () => {
    const { run, delivery } = await prepare("running");
    expect(await materializeRunDelivery(delivery.id, DEMO_WORKSPACE_ID)).toBe(false);
    await db.update(runs).set({ status: "completed" }).where(eq(runs.id, run.id));
    const outcomes = await Promise.all(Array.from({ length: 4 }, () => materializeRunDelivery(delivery.id, DEMO_WORKSPACE_ID)));
    expect(outcomes.filter(Boolean)).toHaveLength(1);
    const row = await deliveryRow(delivery.id);
    const payload = RunDeliveryEnvelope.parse(row.payload);
    expect(payload.task.result).toMatchObject({ amount: 0, approved: false, email: "buyer@example.com" });
    expect(JSON.stringify(payload)).not.toMatch(/private-business-key|privateInput|do-not-deliver|workflowRunId/);
    expect(row.status).toBe("pending");
    await db.update(runs).set({ result: { amount: 99 } }).where(eq(runs.id, run.id));
    expect(await materializeRunDelivery(delivery.id, DEMO_WORKSPACE_ID)).toBe(false);
    expect((await deliveryRow(delivery.id)).payload).toEqual(row.payload);
  });
  it.each(["failed", "cancelled"])("%s 只交付明确终态，不交付过程成果", async (status) => {
    const { delivery } = await prepare(status);
    expect(await materializeRunDelivery(delivery.id, DEMO_WORKSPACE_ID)).toBe(true);
    expect(RunDeliveryEnvelope.parse((await deliveryRow(delivery.id)).payload).task).toMatchObject({ status, result: null, ready: true });
  });
  it("无效深层成果明确拒绝，不能截断后发送", async () => {
    let nested: Record<string, unknown> = { value: 0 };
    for (let i = 0; i < 35; i++) nested = { nested };
    const { delivery } = await prepare("completed", DEMO_WORKSPACE_ID, nested);
    expect(await materializeRunDelivery(delivery.id, DEMO_WORKSPACE_ID)).toBe(false);
    expect(await deliveryRow(delivery.id)).toMatchObject({ status: "failed", payload: null, attempts: 0 });
  });
  it("并发调度只领取一次，启动回执丢失保留租约供接管", async () => {
    const { delivery } = await prepare();
    mocks.start.mockRejectedValue(new Error("响应丢失"));
    await Promise.all([dispatchPendingDeliveriesCore(), dispatchPendingDeliveriesCore()]);
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect(await deliveryRow(delivery.id)).toMatchObject({ status: "queued", attempts: 0, workflowRunId: null });
    const first = await deliveryRow(delivery.id);
    await db.update(runDeliveries).set({ leaseExpiresAt: new Date(Date.now() - 1) }).where(eq(runDeliveries.id, delivery.id));
    await dispatchPendingDeliveriesCore();
    expect((await deliveryRow(delivery.id)).leaseOwner).not.toBe(first.leaseOwner);
    expect(mocks.start).toHaveBeenCalledTimes(2);
  });
  it("同一租约并发尝试不会并发发送，成功不改写主任务", async () => {
    const { run, delivery, token } = await queued();
    const send = vi.fn<typeof fetch>().mockResolvedValue(ack(delivery.id));
    const outcomes = await Promise.all([attemptRunDeliveryCore(delivery.id, DEMO_WORKSPACE_ID, token, send), attemptRunDeliveryCore(delivery.id, DEMO_WORKSPACE_ID, token, send)]);
    expect(outcomes.some((outcome) => outcome.kind === "delivered")).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await deliveryRow(delivery.id)).toMatchObject({ status: "delivered", attempts: 1, receipt: { deliveryId: delivery.id } });
    expect((await db.select().from(runs).where(eq(runs.id, run.id)))[0].status).toBe("completed");
  });
  it("响应丢失沿用冻结成果、防重键和固定有效期", async () => {
    const { delivery, token } = await queued();
    const send = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error("接收成功但响应丢失")).mockResolvedValueOnce(ack(delivery.id));
    expect((await attemptRunDeliveryCore(delivery.id, DEMO_WORKSPACE_ID, token, send)).kind).toBe("retry");
    const first = await deliveryRow(delivery.id);
    await db.update(runDeliveries).set({ nextAttemptAt: new Date(Date.now() - 1) }).where(eq(runDeliveries.id, delivery.id));
    expect((await attemptRunDeliveryCore(delivery.id, DEMO_WORKSPACE_ID, token, send)).kind).toBe("delivered");
    const last = await deliveryRow(delivery.id);
    expect(last.retryDeadline).toEqual(first.retryDeadline);
    expect(last.attempts).toBe(2);
    expect(send.mock.calls[0][1]?.body).toBe(send.mock.calls[1][1]?.body);
    expect(new Headers(send.mock.calls[0][1]?.headers).get("idempotency-key")).toBe(new Headers(send.mock.calls[1][1]?.headers).get("idempotency-key"));
  });
  it("旧租约的迟到回执不能覆盖接管后的投递结果", async () => {
    const { delivery, token } = await queued();
    let started!: () => void, release!: () => void;
    const inFlight = new Promise<void>((resolve) => { started = resolve; });
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const oldSend = vi.fn<typeof fetch>(async () => { started(); await waiting; return ack(delivery.id, "old-receipt"); });
    const oldAttempt = attemptRunDeliveryCore(delivery.id, DEMO_WORKSPACE_ID, token, oldSend);
    await inFlight;
    try {
      await db.update(runDeliveries).set({ leaseExpiresAt: new Date(Date.now() - 1) }).where(eq(runDeliveries.id, delivery.id));
      await dispatchPendingDeliveriesCore();
      const current = await deliveryRow(delivery.id);
      const newSend = vi.fn<typeof fetch>().mockResolvedValue(ack(delivery.id, "new-receipt"));
      expect((await attemptRunDeliveryCore(delivery.id, DEMO_WORKSPACE_ID, current.leaseOwner!, newSend)).kind).toBe("delivered");
    } finally { release(); }
    expect((await oldAttempt).kind).toBe("stale");
    expect((await deliveryRow(delivery.id)).receipt?.receiptId).toBe("new-receipt");
  });
  it("过期防重保证与接收方变更都会在发送前停止", async () => {
    const { delivery, token } = await queued();
    const send = vi.fn<typeof fetch>();
    await db.update(runDeliveries).set({ retryDeadline: new Date(Date.now() - 1) }).where(eq(runDeliveries.id, delivery.id));
    expect((await attemptRunDeliveryCore(delivery.id, DEMO_WORKSPACE_ID, token, send)).kind).toBe("fatal");
    expect(send).not.toHaveBeenCalled();
    expect((await retryRunDeliveryAction(delivery.runId, { requestId: randomUUID(), confirmed: true, reason: "已核对" })).ok).toBe(false);
    const next = await queued();
    vi.stubEnv("RUN_DELIVERY_TARGETS_JSON", JSON.stringify([{ ...target, endpoint: "https://other.test" }]));
    expect((await attemptRunDeliveryCore(next.delivery.id, DEMO_WORKSPACE_ID, next.token, send)).kind).toBe("fatal");
    expect(send).not.toHaveBeenCalled();
  });
  it("人工补投登记防重且不重置尝试次数或延长有效期", async () => {
    const { delivery } = await queued();
    const deadline = new Date(Date.now() + 600_000);
    await db.update(runDeliveries).set({ status: "failed", attempts: 5, retryDeadline: deadline, leaseOwner: null, leaseExpiresAt: null }).where(eq(runDeliveries.id, delivery.id));
    const request = { requestId: randomUUID(), confirmed: true as const, reason: "已核对接收方支持原标识防重" };
    const results = await Promise.all([retryRunDeliveryAction(delivery.runId, request), retryRunDeliveryAction(delivery.runId, request)]);
    expect(results.every((result) => result.ok)).toBe(true);
    const row = await deliveryRow(delivery.id);
    expect(row).toMatchObject({ status: "pending", attempts: 5, maxAttempts: 10 });
    expect(row.retryDeadline).toEqual(deadline);
    expect(row.resolutions).toHaveLength(1);
    expect((await retryRunDeliveryAction(delivery.runId, { ...request, reason: "更改原因" })).ok).toBe(false);
  });
  it("历史坏快照不能通过人工确认重新排队", async () => {
    const { delivery } = await queued();
    await db.update(runDeliveries).set({ status: "failed", payload: { schemaVersion: 1, deliveryId: delivery.id, task: { runId: randomUUID() } } as unknown as RunDeliveryEnvelope,
      leaseOwner: null, leaseExpiresAt: null }).where(eq(runDeliveries.id, delivery.id));
    expect((await retryRunDeliveryAction(delivery.runId, { requestId: randomUUID(), confirmed: true, reason: "已核对" })).ok).toBe(false);
    expect(await deliveryRow(delivery.id)).toMatchObject({ status: "failed", maxAttempts: 5, resolutions: [] });
  });
  it("查询严格隔离工作区，摘要不加载快照、密钥或引擎句柄", async () => {
    const { delivery } = await queued();
    const context = { params: Promise.resolve({ runId: delivery.runId }) };
    const response = await GET(new Request(`http://localhost/api/runs/${delivery.runId}/delivery`), context);
    expect(response.status).toBe(200);
    const result = RunDeliveryResult.parse(await response.json());
    expect(JSON.stringify(result)).not.toMatch(/payload|targetHash|leaseOwner|workflowRunId|private-receiver|private-business-key/);
    const other = await prepare("completed", randomUUID());
    expect((await GET(new Request("http://localhost"), { params: Promise.resolve({ runId: other.run.id }) })).status).toBe(404);
  });
  it("提交任务和投递意图原子创建，原请求不能偷偷改换交付", async () => {
    const agentId = randomUUID(), versionId = randomUUID(); agentIds.push(agentId); versionIds.push(versionId);
    const manifest = AgentManifest.parse({ schemaVersion: "4.0", workflowFingerprint: "delivery-start", inputContract: { fields: [] }, resourceSelection: { model: { modelId: "mock", mock: true } },
      designAudit: { status: "passed", issueCount: 0, criticalCount: 0 }, workflowSnapshot: { id: "test", startNodeId: "start", rootAgent: { id: agentId, name: "投递助手", role: "测试" },
        memoryPolicy: { taskContext: true, longTerm: false }, nodes: { start: { id: "start", title: "开始", type: "trigger", next: "done" }, done: { id: "done", title: "结束", type: "end" } } } });
    await db.insert(agents).values({ id: agentId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, name: "投递助手", intentText: "测试成果投递事务" });
    await db.insert(agentVersions).values({ id: versionId, agentId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, version: 1, status: "production", manifest });
    const input = { agentId, input: { amount: 0 }, sourceKey: `manual:${randomUUID()}`, deliveryTargetId: target.id };
    const results = await Promise.all([startRunCore(input), startRunCore(input)]);
    if (!results[0].ok || !results[1].ok) throw new Error("提交失败");
    runIds.push(results[0].runId);
    expect(results[0].runId).toBe(results[1].runId);
    const rows = await db.select().from(runDeliveries).where(eq(runDeliveries.runId, results[0].runId));
    expect(rows).toHaveLength(1); expect(rows[0].status).toBe("waiting_result"); expect(mocks.start).toHaveBeenCalledTimes(1);
    const originalTransaction = db.transaction.bind(db);
    vi.spyOn(db, "transaction").mockImplementationOnce((async (callback: Parameters<typeof db.transaction>[0]) => originalTransaction(async (tx) => {
      const originalInsert = tx.insert.bind(tx);
      tx.insert = ((table: Parameters<typeof tx.insert>[0]) => {
        if (table === runDeliveries) throw new Error("投递登记失败");
        return originalInsert(table);
      }) as typeof tx.insert;
      try { return await callback(tx); } finally { tx.insert = originalInsert; }
    })) as typeof db.transaction);
    const rollbackKey = `manual:${randomUUID()}`;
    expect((await startRunCore({ ...input, sourceKey: rollbackKey })).ok).toBe(false);
    expect(await db.select().from(runs).where(eq(runs.sourceKey, rollbackKey))).toHaveLength(0);
    expect(mocks.start).toHaveBeenCalledTimes(1);
    expect((await startRunCore({ ...input, deliveryTargetId: undefined })).ok).toBe(false);
    expect((await startRunCore({ ...input, deliveryTargetId: "other" })).ok).toBe(false);
    vi.stubEnv("RUN_DELIVERY_TARGETS_JSON", "");
    expect(await startRunCore(input)).toEqual({ ok: true, runId: results[0].runId });
  });
});
