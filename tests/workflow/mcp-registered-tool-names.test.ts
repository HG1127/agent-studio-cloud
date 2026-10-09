import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { start } from "workflow/api";
import { AgentManifest } from "@/contracts/manifest";
import { runs, runSteps, toolOperations, traceEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { agentRunWorkflow } from "@/server/workflows/agent-run";
import { assertMvpAcceptanceIsolatedDb } from "../helpers/mvp-acceptance-template";
import { startRegisteredNameMcpServer } from "../fixtures/mcp-registered-tool-name-server";
beforeAll(assertMvpAcceptanceIsolatedDb);
let service: Awaited<ReturnType<typeof startRegisteredNameMcpServer>> | undefined;
let runIds: string[] = [];
afterEach(async () => {
  await service?.close(); service = undefined; vi.unstubAllEnvs();
  if (runIds.length) {
    await db.delete(toolOperations).where(inArray(toolOperations.sourceRunId, runIds));
    await db.delete(traceEvents).where(inArray(traceEvents.runId, runIds));
    await db.delete(runSteps).where(inArray(runSteps.runId, runIds));
    await db.delete(runs).where(inArray(runs.id, runIds));
  }
  runIds = [];
});
describe("远端名称真实持久Workflow验收（仅CI）", () => {
  it.each(["_helper", "a".repeat(101), "a".repeat(128)])("步骤完整调用名称并复用业务回执 %s", async (action) => {
    service = await startRegisteredNameMcpServer(action);
    const tool = { id: "workflow.registered-write", name: "登记操作", action, scope: "business.write", risk: "low", protocol: "mcp-streamable-http", operationKind: "action", endpoint: service.endpoint, businessIdempotency: true, businessIdempotencyRetentionMs: 600000, inputSchema: service.inputSchema, outputSchema: { type: "object" } };
    vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify([tool]));
    const manifest = AgentManifest.parse({ schemaVersion: "4.0", workflowFingerprint: "registered-name-test", inputContract: { fields: [] }, resourceSelection: { model: { modelId: "mock", mock: true } }, designAudit: { status: "passed", issueCount: 0, criticalCount: 0 }, workflowSnapshot: {
      id: "name-test", startNodeId: "start", rootAgent: { id: randomUUID(), name: "登记操作助手", role: "登记" }, memoryPolicy: { taskContext: true, longTerm: false }, nodes: {
        start: { id: "start", title: "收到任务", type: "trigger", next: "write" },
        write: { id: "write", title: "执行操作", type: "tool", next: "done", tool: { connector: tool.id, registryToolId: tool.id, action, scope: tool.scope, protocol: tool.protocol, operationKind: tool.operationKind, risk: tool.risk, inputSchema: tool.inputSchema, outputSchema: tool.outputSchema }, toolOperation: { scope: tool.id, key: { kind: "input", path: ["requestKey"] } }, inputMapping: { fields: ["amount", "approved"].map((field) => ({ target: [field], source: { kind: "input", path: [field] }, required: true })) } },
        done: { id: "done", title: "完成", type: "end" },
      },
    } });
    const input = { requestKey: randomUUID(), amount: 0, approved: false };
    async function run() {
      const [row] = await db.insert(runs).values({ workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, agentId: manifest.workflowSnapshot.rootAgent.id, versionId: randomUUID(), status: "queued", input }).returning({ id: runs.id });
      runIds.push(row.id);
      return start(agentRunWorkflow, [row.id, manifest, input]);
    }
    await expect((await run()).returnValue).resolves.toEqual({ status: "completed" });
    await expect((await run()).returnValue).resolves.toEqual({ status: "completed" });
    const [operation] = await db.select().from(toolOperations).where(eq(toolOperations.sourceRunId, runIds[0]));
    expect(operation).toMatchObject({ action, status: "completed", receipt: { receiptId: "test-receipt", amount: 0, approved: false } });
    const [second] = await db.select().from(runs).where(eq(runs.id, runIds[1]));
    expect(second.result).toMatchObject({ write: { ok: true, amount: 0, approved: false } });
    expect(service.messages.filter((message) => message.method === "tools/call")).toEqual([{ method: "tools/call", params: { name: action, arguments: { amount: 0, approved: false } } }]);
  });
});
