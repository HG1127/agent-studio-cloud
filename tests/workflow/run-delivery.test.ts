import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getRun, start } from "workflow/api";
import { AgentManifest } from "@/contracts/manifest";
import { agents, agentVersions, runDeliveries, runs, runSteps, traceEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { deliverRunWorkflow } from "@/server/workflows/run-delivery";
import { deliveryTargetBinding, parseDeliveryTargets } from "@/server/delivery/target-registry";
import { dispatchPendingDeliveriesCore, materializeRunDelivery } from "@/server/services/run-delivery";
import { startRunCore } from "@/server/services/start-run-core";
import { startRunDeliveryServer } from "../helpers/run-delivery-server";

let service: Awaited<ReturnType<typeof startRunDeliveryServer>> | undefined;
let runIds: string[] = [], agentIds: string[] = [], versionIds: string[] = [];
afterEach(async () => {
  await service?.close(); service = undefined; vi.unstubAllEnvs();
  if (runIds.length) {
    await db.delete(runDeliveries).where(inArray(runDeliveries.runId, runIds));
    await db.delete(traceEvents).where(inArray(traceEvents.runId, runIds));
    await db.delete(runSteps).where(inArray(runSteps.runId, runIds));
    await db.delete(runs).where(inArray(runs.id, runIds));
  }
  if (versionIds.length) await db.delete(agentVersions).where(inArray(agentVersions.id, versionIds));
  if (agentIds.length) await db.delete(agents).where(inArray(agents.id, agentIds));
  runIds = []; agentIds = []; versionIds = [];
});
async function target(options: Parameters<typeof startRunDeliveryServer>[0] = {}) {
  service = await startRunDeliveryServer(options);
  const value = { id: "workflow.delivery", revision: "1", endpoint: service.endpoint, idempotent: true, retentionMs: 600_000 };
  vi.stubEnv("RUN_DELIVERY_TARGETS_JSON", JSON.stringify([value]));
  return deliveryTargetBinding(parseDeliveryTargets(JSON.stringify([value]), true)[0]);
}
async function prepare(options: Parameters<typeof startRunDeliveryServer>[0] = {}, status = "completed") {
  const binding = await target(options);
  const [run] = await db.insert(runs).values({ workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, agentId: randomUUID(), versionId: randomUUID(), status,
    result: { amount: 0, approved: false, email: "buyer@example.com", apiKey: "private-output-key" } }).returning();
  runIds.push(run.id);
  const [delivery] = await db.insert(runDeliveries).values({ workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, runId: run.id, ...binding }).returning();
  await materializeRunDelivery(delivery.id, DEMO_WORKSPACE_ID);
  const token = randomUUID();
  await db.update(runDeliveries).set({ status: "queued", leaseOwner: token, leaseExpiresAt: new Date(Date.now() + 120_000) }).where(eq(runDeliveries.id, delivery.id));
  return { run, delivery, token };
}
describe("真实持久引擎成果投递", () => {
  it("接收响应丢失后实际 SDK 重试，接收业务只生效一次", async () => {
    const { run, delivery, token } = await prepare({ loseFirstResponse: true });
    const handle = await start(deliverRunWorkflow, [delivery.id, DEMO_WORKSPACE_ID, token]);
    expect(await handle.returnValue).toBe("delivered");
    const [row] = await db.select().from(runDeliveries).where(eq(runDeliveries.id, delivery.id));
    expect(row).toMatchObject({ status: "delivered", attempts: 2, receipt: { deliveryId: delivery.id, receiptId: "receipt-1" } });
    expect(service!.effectCount()).toBe(1); expect(service!.requests).toHaveLength(2);
    expect(service!.requests[0]).toEqual(service!.requests[1]);
    expect(service!.requests[0].payload.task.result).toMatchObject({ amount: 0, approved: false, email: "buyer@example.com" });
    expect(JSON.stringify(service!.requests)).not.toContain("private-output-key");
    expect((await db.select().from(runs).where(eq(runs.id, run.id)))[0].status).toBe("completed");
  });
  it("错误回执永久停止投递，但不把成功主任务改成失败", async () => {
    const { run, delivery, token } = await prepare({ wrongReceipt: true });
    const handle = await start(deliverRunWorkflow, [delivery.id, DEMO_WORKSPACE_ID, token]);
    await expect(handle.returnValue).rejects.toThrow();
    expect((await db.select().from(runDeliveries).where(eq(runDeliveries.id, delivery.id)))[0]).toMatchObject({ status: "failed", attempts: 1, receipt: null });
    expect((await db.select().from(runs).where(eq(runs.id, run.id)))[0].status).toBe("completed");
    expect(service!.requests).toHaveLength(1);
  });
  it("真实任务提交先登记意图，执行完成后由投递调度交付冻结成果", async () => {
    const binding = await target();
    const agentId = randomUUID(), versionId = randomUUID(); agentIds.push(agentId); versionIds.push(versionId);
    const manifest = AgentManifest.parse({ schemaVersion: "4.0", workflowFingerprint: "delivery-task", inputContract: { fields: [] }, resourceSelection: { model: { modelId: "mock", mock: true } },
      designAudit: { status: "passed", issueCount: 0, criticalCount: 0 }, workflowSnapshot: { id: "delivery-task", startNodeId: "start", rootAgent: { id: agentId, name: "成果助手", role: "测试" }, memoryPolicy: { taskContext: true, longTerm: false },
        nodes: { start: { id: "start", title: "开始", type: "trigger", next: "reply" }, reply: { id: "reply", title: "生成成果", type: "ai", next: "done" }, done: { id: "done", title: "完成", type: "end" } } } });
    await db.insert(agents).values({ id: agentId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, name: "成果助手", intentText: "验证自动交付" });
    await db.insert(agentVersions).values({ id: versionId, agentId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, version: 1, status: "production", manifest });
    const started = await startRunCore({ agentId, input: { amount: 0 }, sourceKey: `manual:${randomUUID()}`, deliveryTargetId: binding.targetId });
    if (!started.ok) throw new Error(started.error);
    runIds.push(started.runId);
    const [run] = await db.select().from(runs).where(eq(runs.id, started.runId));
    await getRun(run.workflowRunId!).returnValue;
    const tick = await dispatchPendingDeliveriesCore();
    expect(tick).toMatchObject({ materialized: 1, claimed: 1 });
    await expect.poll(async () => (await db.select().from(runDeliveries).where(eq(runDeliveries.runId, run.id)))[0].status, { timeout: 120_000, interval: 500 }).toBe("delivered");
    const [completed] = await db.select().from(runs).where(eq(runs.id, run.id));
    expect(service!.requests[0].payload.task.result).toEqual(completed.result);
    expect(service!.effectCount()).toBe(1);
  });
});
