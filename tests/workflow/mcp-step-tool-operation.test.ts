import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { start, type Run } from "workflow/api";
import { AgentManifest } from "@/contracts/manifest";
import { runs, runSteps, toolOperations, traceEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { agentRunWorkflow } from "@/server/workflows/agent-run";
import { startMcpTestServer } from "../fixtures/mcp-server";
import { cleanupMcpStepToolRun } from "../helpers/mcp-step-tool-operation-cleanup";

let server: Awaited<ReturnType<typeof startMcpTestServer>> | undefined;
const runIds: string[] = [];
const handles: Array<Run<unknown>> = [];
const pendingStartRunIds = new Set<string>();
let cleanupFailed = false;
afterEach(async () => {
  try {
    await cleanupMcpStepToolRun({ handles, pendingStartRunIds: [...pendingStartRunIds],
      deleteOwnedRecords: async () => {
        if (!runIds.length) return;
        await db.delete(toolOperations).where(inArray(toolOperations.sourceRunId, runIds));
        await db.delete(traceEvents).where(inArray(traceEvents.runId, runIds));
        await db.delete(runSteps).where(inArray(runSteps.runId, runIds));
        await db.delete(runs).where(inArray(runs.id, runIds));
      },
      closeService: async () => { await server?.close(); }, restoreEnvironment: () => vi.unstubAllEnvs(),
    });
    runIds.length = 0; handles.length = 0; pendingStartRunIds.clear();
  } catch (error) { cleanupFailed = true; throw error; }
  finally { server = undefined; }
});
async function run(loseFirstResponse: boolean, inline = false) {
  if (cleanupFailed) throw new Error("上次验收清理未完成，不能启动新的工作流");
  server = await startMcpTestServer({ inputSchema: { type: "object" }, output: { receiptId: "receipt-1" }, loseFirstResponse });
  const inputSchema = server.schema, outputSchema = { type: "object", required: ["receiptId"], properties: { receiptId: { type: "string" } } };
  const tool = { id: "workflow.mcp-write", name: "登记", endpoint: server.endpoint, action: "lookup_customer", scope: "write", risk: "low",
    protocol: "mcp-streamable-http", operationKind: "action", businessIdempotency: true, businessIdempotencyRetentionMs: 600_000, inputSchema, outputSchema };
  vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify([tool]));
  const writeStep = { id: "write", title: "登记", type: "tool", next: "done", retry: { maxAttempts: 3, backoffMs: 50 },
    tool: { connector: "本机服务", action: tool.action, scope: tool.scope, risk: tool.risk, registryToolId: tool.id,
      protocol: tool.protocol, operationKind: tool.operationKind, inputSchema, outputSchema } };
  const manifest = AgentManifest.parse({ schemaVersion: "4.0", workflowFingerprint: "mcp-step-ledger-test", inputContract: { fields: [] },
    resourceSelection: { model: { modelId: "mock", mock: true } }, designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
    workflowSnapshot: { id: "test", startNodeId: "start", rootAgent: { id: randomUUID(), name: "登记助手", role: "登记" }, memoryPolicy: { taskContext: true, longTerm: false },
      nodes: {
        start: { id: "start", title: "收到任务", type: "trigger", next: "write" },
        write: inline ? { id: "write", title: "登记", type: "subflow", next: "done", subflow: { name: "登记订单", steps: [{ ...writeStep, id: "登记", next: null }] } } : writeStep,
        done: { id: "done", title: "完成", type: "end" },
      },
    },
  });
  const [row] = await db.insert(runs).values({ workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
    agentId: manifest.workflowSnapshot.rootAgent.id, versionId: randomUUID(), status: "queued", input: {} }).returning({ id: runs.id });
  runIds.push(row.id);
  pendingStartRunIds.add(row.id);
  const handle = await start(agentRunWorkflow, [row.id, manifest, {}]);
  handles.push(handle);
  pendingStartRunIds.delete(row.id);
  return handle;
}
describe("真实持久工作流MCP写步骤默认账本", () => {
  it("真实中文子流程工具丢失首次回执后，稳定安全键与账本保持单次业务效果", async () => {
    const pending = await run(true, true);
    await expect(pending.returnValue).resolves.toEqual({ status: "completed" });
    const calls = server!.messages.filter((message) => message.method === "tools/call");
    expect(calls).toHaveLength(2);
    expect(new Set(calls.map((message) => message.key)).size).toBe(1);
    expect(calls[0].key).toMatch(/^studio-step-header:v1:[a-f0-9]{64}$/);
    expect(server!.effectCount()).toBe(1);
    const operations = await db.select().from(toolOperations).where(eq(toolOperations.sourceRunId, runIds[0]));
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ status: "completed", receipt: { receiptId: "receipt-1" } });
  }, 240_000);
  it.each([false, true])("未配置跨运行键也持久保护写步骤，首次回执丢失 %s", async (loseFirstResponse) => {
    const pending = await run(loseFirstResponse);
    await expect(pending.returnValue).resolves.toEqual({ status: "completed" });
    const calls = server!.messages.filter((message) => message.method === "tools/call");
    expect(calls).toHaveLength(loseFirstResponse ? 2 : 1);
    expect(new Set(calls.map((message) => message.key)).size).toBe(1);
    expect(calls[0].key).toMatch(new RegExp(`^${runIds[0]}:write:`));
    expect(server!.effectCount()).toBe(1);
    const operations = await db.select().from(toolOperations).where(eq(toolOperations.sourceRunId, runIds[0]));
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ status: "completed", receipt: { receiptId: "receipt-1" } });
    expect(operations[0].retryDeadline.getTime()).toBeGreaterThan(operations[0].createdAt.getTime());
  }, 240_000);
});
