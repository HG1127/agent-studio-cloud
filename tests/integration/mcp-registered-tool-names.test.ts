import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import { runs, toolOperations } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { invokeToolOperation } from "@/server/services/tool-operation";
import { parseToolRegistry } from "@/server/tools/tool-registry";
import { assertMvpAcceptanceIsolatedDb } from "../helpers/mvp-acceptance-template";
import { startRegisteredNameMcpServer } from "../fixtures/mcp-registered-tool-name-server";
beforeAll(assertMvpAcceptanceIsolatedDb);
let service: Awaited<ReturnType<typeof startRegisteredNameMcpServer>> | undefined;
let runIds: string[] = [];
afterEach(async () => {
  await service?.close(); service = undefined; vi.unstubAllEnvs();
  if (runIds.length) {
    await db.delete(toolOperations).where(inArray(toolOperations.sourceRunId, runIds));
    await db.delete(runs).where(inArray(runs.id, runIds));
  }
  runIds = [];
});
describe("远端名称真实隔离数据库账本验收（仅CI）", () => {
  it.each(["_helper", "a".repeat(101), "a".repeat(128)])("完整保存名称并跨运行复用回执 %s", async (action) => {
    service = await startRegisteredNameMcpServer(action);
    const tool = parseToolRegistry(JSON.stringify([{ id: "registered-write", name: "登记操作", action, scope: "business.write", protocol: "mcp-streamable-http", operationKind: "action", endpoint: service.endpoint, businessIdempotency: true, businessIdempotencyRetentionMs: 600000, inputSchema: service.inputSchema, outputSchema: { type: "object" } }]))[0];
    const node = WorkflowNode.parse({ id: "write", title: "执行操作", type: "tool", tool: { connector: tool.id, registryToolId: tool.id, action, scope: tool.scope, protocol: tool.protocol, operationKind: tool.operationKind, risk: tool.risk, inputSchema: tool.inputSchema, outputSchema: tool.outputSchema }, toolOperation: { scope: tool.id, key: { kind: "input", path: ["requestKey"] } } });
    const input = { requestKey: randomUUID() };
    async function invoke() {
      const [run] = await db.insert(runs).values({ workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, agentId: randomUUID(), versionId: randomUUID(), status: "running", input }).returning({ id: runs.id });
      runIds.push(run.id);
      return invokeToolOperation({ runId: run.id, node, tool, input, outputs: {}, payload: { action, input: { amount: 0, approved: false }, outputs: {} } });
    }
    const first = await invoke(), second = await invoke();
    expect(first).toMatchObject({ ok: true, reused: false }); expect(second).toMatchObject({ ok: true, reused: true });
    if (!first.ok || !second.ok) throw new Error("完整名称操作应成功");
    expect(second.operationId).toBe(first.operationId);
    const [row] = await db.select().from(toolOperations).where(eq(toolOperations.id, first.operationId));
    expect(row).toMatchObject({ action, status: "completed", receipt: { receiptId: "test-receipt", amount: 0, approved: false } });
    expect(service.messages.filter((message) => message.method === "tools/call")).toEqual([{ method: "tools/call", params: { name: action, arguments: { amount: 0, approved: false } } }]);
  });
});
