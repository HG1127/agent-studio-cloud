import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { start } from "workflow/api";
import { AgentManifest } from "@/contracts/manifest";
import { runs, runSteps, toolOperations, traceEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { agentRunWorkflow } from "@/server/workflows/agent-run";
import { startToolOperationServer } from "../helpers/tool-operation-server";

let service: Awaited<ReturnType<typeof startToolOperationServer>> | undefined;
let manifest: AgentManifest;
let runIds: string[] = [];
afterEach(async () => {
  await service?.close();
  service = undefined;
  vi.unstubAllEnvs();
  if (runIds.length) {
    await db.delete(toolOperations).where(inArray(toolOperations.sourceRunId, runIds));
    await db.delete(traceEvents).where(inArray(traceEvents.runId, runIds));
    await db.delete(runSteps).where(inArray(runSteps.runId, runIds));
    await db.delete(runs).where(inArray(runs.id, runIds));
  }
  runIds = [];
});
async function prepare(loseFirstResponse = false) {
  service = await startToolOperationServer(loseFirstResponse);
  const inputSchema = { type: "object" }, outputSchema = { type: "object", required: ["receiptId"], properties: { receiptId: { type: "string" } } };
  const tool = {
    id: "workflow.orders", name: "登记订单", action: "record", scope: "orders.write", risk: "low",
    endpoint: service.endpoint, businessIdempotency: true, businessIdempotencyRetentionMs: 600_000, inputSchema, outputSchema,
  };
  vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify([tool]));
  manifest = AgentManifest.parse({
    schemaVersion: "4.0", workflowFingerprint: "tool-operation-test", inputContract: { fields: [] },
    resourceSelection: { model: { modelId: "mock", mock: true } }, designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
    workflowSnapshot: {
      id: "test", startNodeId: "start", rootAgent: { id: randomUUID(), name: "订单助手", role: "登记" }, memoryPolicy: { taskContext: true, longTerm: false },
      nodes: {
        start: { id: "start", title: "收到任务", type: "trigger", next: "record" },
        record: { id: "record", title: "登记订单", type: "tool", next: "done", retry: { maxAttempts: 3, backoffMs: 50 },
          tool: { connector: "订单", action: tool.action, scope: tool.scope, risk: tool.risk, registryToolId: tool.id, protocol: "http-json", inputSchema, outputSchema },
          toolOperation: { scope: "order-create", key: { kind: "input", path: ["orderId"] } },
          inputMapping: { fields: [
            { target: ["orderId"], source: { kind: "input", path: ["orderId"] } },
            { target: ["amount"], source: { kind: "input", path: ["amount"] } },
          ] },
        },
        done: { id: "done", title: "完成", type: "end" },
      },
    },
  });
}
async function run(amount = 10, note = "not-selected") {
  const input = { orderId: "o1", amount, note };
  const [row] = await db.insert(runs).values({
    workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, agentId: manifest.workflowSnapshot.rootAgent.id,
    versionId: randomUUID(), status: "queued", input,
  }).returning({ id: runs.id });
  runIds.push(row.id);
  return start(agentRunWorkflow, [row.id, manifest, input]);
}
describe("真实持久工作流跨运行业务防重", () => {
  it("手动重跑准确复用业务回执，不因无关输入或新运行产生第二次写入", async () => {
    await prepare();
    await expect((await run()).returnValue).resolves.toEqual({ status: "completed" });
    await expect((await run(10, "different-unselected-note")).returnValue).resolves.toEqual({ status: "completed" });
    expect(service!.requests).toHaveLength(1);
    expect(service!.effectCount()).toBe(1);
    const [second] = await db.select().from(runs).where(eq(runs.id, runIds[1]));
    expect(second.result).toMatchObject({ record: { ok: true, receiptId: "receipt-1" } });
    const traces = await db.select().from(traceEvents).where(eq(traceEvents.runId, runIds[1]));
    expect(traces.find((trace) => trace.kind === "tool.operation_reused")).toBeDefined();
  }, 240_000);
  it("外部已经写入但首次响应丢失，SDK 重试同键，业务副作用仍只有一次", async () => {
    await prepare(true);
    await expect((await run()).returnValue).resolves.toEqual({ status: "completed" });
    expect(service!.requests).toHaveLength(2);
    expect(new Set(service!.requests.map((request) => request.key)).size).toBe(1);
    expect(service!.effectCount()).toBe(1);
    const [operation] = await db.select().from(toolOperations).where(eq(toolOperations.sourceRunId, runIds[0]));
    expect(operation).toMatchObject({ status: "completed", receipt: { receiptId: "receipt-1" } });
  }, 240_000);
  it("已完成操作的金额变化明确失败，不给业务系统发新的写入", async () => {
    await prepare();
    await expect((await run()).returnValue).resolves.toEqual({ status: "completed" });
    await expect((await run(20)).returnValue).rejects.toThrow("请求内容已变化");
    await vi.waitFor(async () => {
      const [failed] = await db.select().from(runs).where(eq(runs.id, runIds[1]));
      expect(failed.status).toBe("failed");
    }, { timeout: 30_000, interval: 500 });
    expect(service!.requests).toHaveLength(1);
    expect(service!.effectCount()).toBe(1);
  }, 240_000);
});
