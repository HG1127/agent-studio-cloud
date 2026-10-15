import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowNode } from "@/contracts/workflow";
import { runs, toolOperations } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { resolveStepToolOperation } from "@/server/domain/runtime/tool-operation";
import { invokeToolOperation } from "@/server/services/tool-operation";
import { parseToolRegistry } from "@/server/tools/tool-registry";
import { startMcpTestServer } from "../fixtures/mcp-server";

let server: Awaited<ReturnType<typeof startMcpTestServer>>;
let tool: ReturnType<typeof parseToolRegistry>[number];
let node: WorkflowNode;
let runIds: string[] = [];
beforeEach(async () => {
  server = await startMcpTestServer({ inputSchema: { type: "object" }, output: { receiptId: "mcp-receipt" } });
  tool = parseToolRegistry(JSON.stringify([{
    id: "mcp.step.write", name: "登记", endpoint: server.endpoint, action: "lookup_customer", scope: "write", risk: "low",
    protocol: "mcp-streamable-http", operationKind: "action", businessIdempotency: true, businessIdempotencyRetentionMs: 600_000,
    inputSchema: server.schema, outputSchema: { type: "object", required: ["receiptId"], properties: { receiptId: { type: "string" } } },
  }]))[0];
  node = WorkflowNode.parse({ id: "write", title: "登记", type: "tool", tool: {
    connector: "本机服务", registryToolId: tool.id, protocol: tool.protocol, operationKind: tool.operationKind,
    action: tool.action, scope: tool.scope, risk: tool.risk, inputSchema: tool.inputSchema, outputSchema: tool.outputSchema,
  } });
});
afterEach(async () => {
  await server?.close();
  if (runIds.length) {
    await db.delete(toolOperations).where(inArray(toolOperations.sourceRunId, runIds));
    await db.delete(runs).where(inArray(runs.id, runIds));
  }
  runIds = [];
});
async function createRun() {
  const [row] = await db.insert(runs).values({ workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
    agentId: randomUUID(), versionId: randomUUID(), status: "running", input: {} }).returning({ id: runs.id });
  runIds.push(row.id);
  return row.id;
}
function invoke(runId: string, stepId: string, attempt: number, startedAt = new Date()) {
  const operation = resolveStepToolOperation({ node, runId, stepId, attempt, startedAt });
  if (!operation.ok || !operation.config) throw new Error("测试步骤配置无效");
  return invokeToolOperation({ runId, node: { ...node, toolOperation: operation.config }, tool, input: {}, outputs: {},
    payload: { action: tool.action, input: {}, outputs: {} }, stepInvocation: operation.stepInvocation });
}
describe("MCP 写步骤持久账本", () => {
  it("保留原外部步骤键，已完成回执即使过期也复用而不再调用", async () => {
    const runId = await createRun();
    const first = await invoke(runId, "step-1", 1);
    expect(first).toMatchObject({ ok: true, reused: false });
    await db.update(toolOperations).set({ retryDeadline: new Date(0) }).where(eq(toolOperations.sourceRunId, runId));
    expect(await invoke(runId, "step-1", 2)).toMatchObject({ ok: true, reused: true, output: { receiptId: "mcp-receipt" } });
    expect(server.messages.filter((message) => message.method === "tools/call")).toEqual([
      expect.objectContaining({ key: `${runId}:write:step-1` }),
    ]);
  });
  it("回执未落库且防重期限已过时阻止重放，不延长原截止时间", async () => {
    const runId = await createRun();
    await invoke(runId, "step-1", 1);
    await db.update(toolOperations).set({ status: "pending", receipt: null, leaseOwner: null, leaseExpiresAt: null,
      retryDeadline: new Date(0) }).where(eq(toolOperations.sourceRunId, runId));
    expect(await invoke(runId, "step-1", 2)).toMatchObject({ ok: false, retryable: false });
    expect(server.messages.filter((message) => message.method === "tools/call")).toHaveLength(1);
    const [row] = await db.select().from(toolOperations).where(eq(toolOperations.sourceRunId, runId));
    expect(row).toMatchObject({ status: "blocked", retryDeadline: new Date(0), receipt: null });
  });
  it("旧步骤重试没有账本时先留下待核对记录，不发送任何远端请求", async () => {
    const runId = await createRun();
    expect(await invoke(runId, "legacy-step", 2)).toMatchObject({ ok: false, retryable: false });
    expect(server.messages).toHaveLength(0);
    const [row] = await db.select().from(toolOperations).where(eq(toolOperations.sourceRunId, runId));
    expect(row).toMatchObject({ status: "blocked", leaseOwner: null, leaseExpiresAt: null, error: expect.stringContaining("旧工具步骤") });
  });
  it("首次执行也以原步骤开始时间为上限，不用恢复时间延长安全窗口", async () => {
    const runId = await createRun();
    expect(await invoke(runId, "stale-step", 1, new Date(0))).toMatchObject({ ok: false, retryable: false });
    expect(server.messages).toHaveLength(0);
    const [row] = await db.select().from(toolOperations).where(eq(toolOperations.sourceRunId, runId));
    expect(row).toMatchObject({ status: "blocked", retryDeadline: new Date(480_000) });
  });
  it("循环新步骤独立写入，不错误复用前一步骤回执", async () => {
    const runId = await createRun();
    expect(await invoke(runId, "step-1", 1)).toMatchObject({ ok: true, reused: false });
    expect(await invoke(runId, "step-2", 1)).toMatchObject({ ok: true, reused: false });
    expect(server.messages.filter((message) => message.method === "tools/call").map((message) => message.key))
      .toEqual([`${runId}:write:step-1`, `${runId}:write:step-2`]);
    expect(await db.select().from(toolOperations).where(eq(toolOperations.sourceRunId, runId))).toHaveLength(2);
  });
});
