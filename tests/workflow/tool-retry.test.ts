import { createServer, type Server } from "node:http";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { start } from "workflow/api";
import { AgentManifest } from "@/contracts/manifest";
import { runSteps, runs } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { agentRunWorkflow } from "@/server/workflows/agent-run";

const AGENT_ID = "00000000-0000-4000-8000-0000000000d1";
const VERSION_ID = "00000000-0000-4000-8000-0000000000d2";

let server: Server | undefined;
const previousRegistry = process.env.TOOL_REGISTRY_JSON;

afterEach(async () => {
  if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  server = undefined;
  if (previousRegistry === undefined) delete process.env.TOOL_REGISTRY_JSON;
  else process.env.TOOL_REGISTRY_JSON = previousRegistry;
});

describe("工具步骤重试", () => {
  it("按节点总尝试次数停止，并在每次调用中复用幂等键", async () => {
    let calls = 0;
    const idempotencyKeys: Array<string | undefined> = [];
    server = createServer((request, response) => {
      calls += 1;
      const idempotencyKey = request.headers["idempotency-key"];
      idempotencyKeys.push(Array.isArray(idempotencyKey) ? idempotencyKey.join(",") : idempotencyKey);
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "temporary" }));
    });
    await new Promise<void>((resolve, reject) => server!.listen(0, "127.0.0.1", () => resolve()).once("error", reject));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("测试服务未启动");

    process.env.TOOL_REGISTRY_JSON = JSON.stringify([{
      id: "retry-test",
      name: "重试测试工具",
      description: "仅用于工作流集成测试",
      endpoint: `http://127.0.0.1:${address.port}/invoke`,
      method: "POST",
      headers: {},
      action: "retry",
      scope: "test.retry",
      risk: "low",
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
    }]);

    const manifest = AgentManifest.parse({
      schemaVersion: "4.0",
      workflowFingerprint: "e".repeat(64),
      inputContract: { fields: [] },
      resourceSelection: { model: { modelId: "mock", mock: true } },
      designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
      workflowSnapshot: {
        id: "draft-tool-retry",
        startNodeId: "start",
        rootAgent: { id: "agt_tool_retry", name: "工具重试测试助手", role: "测试" },
        memoryPolicy: { taskContext: true, longTerm: false },
        nodes: {
          start: { id: "start", title: "收到任务", type: "trigger", next: "retry_tool" },
          retry_tool: {
            id: "retry_tool",
            title: "调用重试工具",
            type: "tool",
            next: "done",
            onErrorNext: "fallback",
            retry: { maxAttempts: 2, backoffMs: 50 },
            tool: {
              connector: "test",
              action: "retry",
              scope: "test.retry",
              risk: "low",
              maxRetries: 8,
              registryToolId: "retry-test",
              protocol: "http-json",
              inputSchema: { type: "object" },
              outputSchema: { type: "object" },
            },
          },
          fallback: { id: "fallback", title: "记录未完成事项", type: "system", next: "done", system: { kind: "record" } },
          done: { id: "done", title: "流程结束", type: "end", next: null },
        },
      },
    });
    const [run] = await db.insert(runs).values({
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      agentId: AGENT_ID,
      versionId: VERSION_ID,
      status: "queued",
      input: {},
    }).returning({ id: runs.id });

    const handle = await start(agentRunWorkflow, [run.id, manifest, {}]);
    await expect(handle.returnValue).resolves.toEqual({ status: "completed" });

    expect(calls).toBe(2);
    expect(new Set(idempotencyKeys)).toEqual(new Set([`${run.id}:retry_tool`]));
    const [step] = await db.select().from(runSteps).where(and(
      eq(runSteps.runId, run.id),
      eq(runSteps.nodeId, "retry_tool"),
    )).limit(1);
    expect(step).toMatchObject({ nodeId: "retry_tool", status: "failed", attempt: 2 });
  }, 240_000);
});
