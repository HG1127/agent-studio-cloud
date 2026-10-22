import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { start, type Run } from "workflow/api";
import { WorkflowNode } from "@/contracts/workflow";
import { runs, runSteps, toolOperations, traceEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { startToolOperationServer } from "../helpers/tool-operation-server";
import { stopRegisteredNameTestRuns } from "../helpers/mcp-registered-tool-name-cleanup";
import { httpDefaultToolOperationWorkflow } from "./http-default-tool-operation.workflow";

let isolated = false;
let cleanupBlocked = false;
let server: Awaited<ReturnType<typeof startToolOperationServer>> | undefined;
const runIds: string[] = [];
const pendingStarts = new Set<string>();
const handles: Run<unknown>[] = [];

beforeAll(() => {
  expect(process.env.MVP_ACCEPTANCE_ISOLATED_DB, "仅允许已有独立数据库证明的验收入口执行").toBe("1");
  isolated = true;
});
beforeEach(() => {
  if (cleanupBlocked) throw new Error("前次自有执行或清理未确认，不能启动新的验收");
});
afterEach(async () => {
  if (!isolated || cleanupBlocked) return;
  const errors: unknown[] = [];
  try {
    await stopRegisteredNameTestRuns(handles, [...pendingStarts]);
    if (runIds.length) {
      await db.delete(toolOperations).where(and(eq(toolOperations.workspaceId, DEMO_WORKSPACE_ID), inArray(toolOperations.sourceRunId, runIds)));
      await db.delete(traceEvents).where(and(eq(traceEvents.workspaceId, DEMO_WORKSPACE_ID), inArray(traceEvents.runId, runIds)));
      await db.delete(runSteps).where(and(eq(runSteps.workspaceId, DEMO_WORKSPACE_ID), inArray(runSteps.runId, runIds)));
      await db.delete(runs).where(and(eq(runs.workspaceId, DEMO_WORKSPACE_ID), eq(runs.createdBy, DEMO_USER_ID), inArray(runs.id, runIds)));
    }
  } catch (error) { errors.push(error); }
  finally {
    try { await server?.close(); server = undefined; } catch (error) { errors.push(error); }
    try { vi.unstubAllEnvs(); } catch (error) { errors.push(error); }
  }
  if (errors.length) {
    cleanupBlocked = true;
    throw new AggregateError(errors, "HTTP 默认台账验收尚未确认退出或清理，保留未确认记录");
  }
  runIds.length = 0; handles.length = 0; pendingStarts.clear();
});

async function execute(loseFirstResponse: boolean) {
  server = await startToolOperationServer(loseFirstResponse);
  const outputSchema = { type: "object", required: ["receiptId"], properties: { receiptId: { type: "string" } } };
  const tool = {
    id: "workflow.http-default", name: "登记订单", action: "record", scope: "orders.write", risk: "low",
    protocol: "http-json", operationKind: "action", method: "POST", endpoint: server.endpoint,
    businessIdempotency: true, businessIdempotencyRetentionMs: 600_000, inputSchema: { type: "object" }, outputSchema,
  };
  vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify([tool]));
  const node = WorkflowNode.parse({
    id: "record", title: "登记订单", type: "tool", retry: { maxAttempts: 3, backoffMs: 50 },
    tool: { connector: "本机测试服务", registryToolId: tool.id, action: tool.action, scope: tool.scope,
      risk: tool.risk, protocol: tool.protocol, operationKind: tool.operationKind, inputSchema: tool.inputSchema, outputSchema },
  });
  const runId = randomUUID();
  pendingStarts.add(runId);
  await db.insert(runs).values({ id: runId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
    agentId: randomUUID(), versionId: randomUUID(), status: "running", input: { amount: 0, approved: false } });
  runIds.push(runId);
  const handle = await start(httpDefaultToolOperationWorkflow, [{
    runId, node, input: { amount: 0, approved: false }, outputs: { before: { note: "upstream" } },
  }]);
  handles.push(handle);
  pendingStarts.delete(runId);
  return { handle, runId, node };
}

describe("真实 SDK 步骤与隔离数据库的默认 HTTP 台账，不替代完整业务助手验收", () => {
  it.each([false, true])("没有显式业务键时 HTTP 默认入账，丢失首次回执=%s", async (loseFirstResponse) => {
    const fixture = await execute(loseFirstResponse);
    expect(fixture.node.toolOperation).toBeUndefined();
    await expect(fixture.handle.returnValue).resolves.toMatchObject({ receipt: { ok: true, receiptId: "receipt-1" } });
    expect(await fixture.handle.status).toBe("completed");
    expect(server!.requests).toHaveLength(loseFirstResponse ? 2 : 1);
    expect(new Set(server!.requests.map((request) => request.key)).size).toBe(1);
    expect(server!.requests[0].key.startsWith(fixture.runId + ":record:")).toBe(true);
    expect(server!.requests[0].payload).toEqual({
      action: "record", input: { amount: 0, approved: false }, outputs: { before: { note: "upstream" } },
    });
    expect(server!.effectCount()).toBe(1);
    const operations = await db.select().from(toolOperations).where(and(
      eq(toolOperations.workspaceId, DEMO_WORKSPACE_ID), eq(toolOperations.sourceRunId, fixture.runId),
    ));
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ status: "completed", toolId: "workflow.http-default", receipt: { receiptId: "receipt-1" } });
    const steps = await db.select().from(runSteps).where(and(
      eq(runSteps.workspaceId, DEMO_WORKSPACE_ID), eq(runSteps.runId, fixture.runId),
    ));
    expect(steps.some((step) => step.nodeId === fixture.node.id && step.status === "succeeded")).toBe(true);
  }, 240_000);
});
