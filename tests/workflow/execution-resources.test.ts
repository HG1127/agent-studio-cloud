import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { start } from "workflow/api";
import { AgentManifest } from "@/contracts/manifest";
import { type ExecutionRunLimits } from "@/contracts/execution-resources";
import { agents, agentVersions, modelCalls, runSteps, runs, traceEvents } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { freezeExecutionResources, presentExecutionPolicy } from "@/server/domain/execution-resources";
import { agentRunWorkflow } from "@/server/workflows/agent-run";
import { startModelJsonServer } from "../helpers/model-json-server";
let service: Awaited<ReturnType<typeof startModelJsonServer>> | undefined, root: string | undefined, targetAgentId: string | undefined, targetVersionId: string | undefined;
const base = { schemaVersion: "4.0", workflowFingerprint: "resource-sdk", inputContract: { fields: [] }, resourceSelection: { model: { modelId: "test-model", mock: false } }, designAudit: { status: "passed", issueCount: 0, criticalCount: 0 } };
function manifest(nodes: Record<string, unknown>, agentId: string) {
  return AgentManifest.parse({ ...base, workflowSnapshot: { id: "resource-sdk", startNodeId: "start", rootAgent: { id: agentId, name: "资源测试助手", role: "测试" }, memoryPolicy: { taskContext: true, longTerm: false }, nodes: {
    start: { id: "start", title: "开始", type: "trigger", next: "first" }, ...nodes, done: { id: "done", title: "完成", type: "end", next: null },
  } } });
}
async function prepare(replies: string[], limits: ExecutionRunLimits, responseStatuses: number[] = []) {
  service = await startModelJsonServer(replies, responseStatuses); vi.stubEnv("MODEL_BASE_URL", service.baseUrl + "/v1"); vi.stubEnv("MODEL_API_KEY", "test-resource-only-key"); vi.stubEnv("MODEL_ID", "test-model"); vi.stubEnv("REAL_MODELS_ENABLED", "1");
  root = crypto.randomUUID(); const agentId = crypto.randomUUID();
  const policy = presentExecutionPolicy({ id: crypto.randomUUID(), revision: 1, limits: { maxConcurrentChains: 10, ...limits }, updatedAt: new Date(), archivedAt: null });
  await db.insert(runs).values({ id: root, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, agentId, versionId: crypto.randomUUID(), status: "queued", input: {}, executionRootRunId: root, executionResources: freezeExecutionResources(policy, "new-root") });
  return { root, agentId, service };
}
afterEach(async () => {
  await service?.close(); service = undefined; vi.unstubAllEnvs();
  if (root) {
    const members = await db.select({ id: runs.id }).from(runs).where(eq(runs.executionRootRunId, root)); const ids = [...new Set([root, ...members.map((row) => row.id)])];
    await db.delete(traceEvents).where(inArray(traceEvents.runId, ids)); await db.delete(runSteps).where(inArray(runSteps.runId, ids)); await db.delete(runs).where(inArray(runs.id, ids));
  }
  if (targetVersionId) await db.delete(agentVersions).where(eq(agentVersions.id, targetVersionId));
  if (targetAgentId) await db.delete(agents).where(eq(agents.id, targetAgentId));
  root = undefined; targetAgentId = undefined; targetVersionId = undefined;
});
async function target() {
  targetAgentId = crypto.randomUUID(); targetVersionId = crypto.randomUUID();
  const outputContract = { fields: [{ path: "first", label: "处理结果", required: true, sourceNodeId: "first" }] };
  const definition = AgentManifest.parse({ ...manifest({ first: { id: "first", title: "协作处理", type: "ai", next: "done" } }, targetAgentId), outputContract,
    workflowSnapshot: { ...manifest({ first: { id: "first", title: "协作处理", type: "ai", next: "done" } }, targetAgentId).workflowSnapshot, outputContract } });
  await db.insert(agents).values({ id: targetAgentId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, name: "资源协作助手", intentText: "协作处理", status: "published" });
  await db.insert(agentVersions).values({ id: targetVersionId, agentId: targetAgentId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, version: 1, status: "production", manifest: definition });
  return { targetAgentId, targetVersionId, outputContract };
}
describe("实际持久执行的资源硬限制", () => {
  it("第二个模型步骤在供应商调用前停止，不登记被拒绝的意图", async () => {
    const fixture = await prepare(["第一次处理完成", "不应被调用"], { maxModelCalls: 1, maxChildRuns: 0 });
    const definition = manifest({ first: { id: "first", title: "第一次处理", type: "ai", next: "second" }, second: { id: "second", title: "第二次处理", type: "ai", next: "done" } }, fixture.agentId);
    const handle = await start(agentRunWorkflow, [fixture.root, definition, {}]); await expect(handle.returnValue).rejects.toThrow();
    expect(fixture.service.modelRequests).toHaveLength(1);
    const [row] = await db.select().from(runs).where(eq(runs.id, fixture.root)); expect(row).toMatchObject({ status: "failed", executionResources: { limits: { maxModelCalls: 1 } } }); expect(row.error).toContain("模型调用上限");
    const ledger = await db.select().from(modelCalls).where(eq(modelCalls.runId, fixture.root)); expect(ledger).toHaveLength(1); expect(ledger[0]).toMatchObject({ state: "returned", measurement: { knownTotalTokens: 18 } });
  }, 240_000);
  it("格式修正同样消费额度，达到上限不能再调模型或执行下游工具", async () => {
    const fixture = await prepare(["不是合法对象", '{"amount":10}'], { maxModelCalls: 1, maxChildRuns: 0 });
    const tool = { id: "resource-record", name: "记录金额", endpoint: fixture.service.baseUrl + "/invoke", action: "record", scope: "test.record", risk: "low", inputSchema: { type: "object" }, outputSchema: { type: "object" } };
    vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify([tool]));
    const definition = manifest({ first: { id: "first", title: "提取金额", type: "ai", next: "record", modelOutput: { format: "json", providerMode: "json", maxRepairAttempts: 1, schema: { type: "object", required: ["amount"], additionalProperties: false, properties: { amount: { type: "number" } } } } },
      record: { id: "record", title: "记录金额", type: "tool", next: "done", tool: { connector: "test", action: tool.action, scope: tool.scope, risk: "low", registryToolId: tool.id, protocol: "http-json", inputSchema: tool.inputSchema, outputSchema: tool.outputSchema } },
    }, fixture.agentId);
    const handle = await start(agentRunWorkflow, [fixture.root, definition, {}]); await expect(handle.returnValue).rejects.toThrow();
    expect(fixture.service.modelRequests).toHaveLength(1); expect(fixture.service.toolRequests).toHaveLength(0);
    const ledger = await db.select().from(modelCalls).where(eq(modelCalls.runId, fixture.root)); expect(ledger).toHaveLength(1); expect(ledger[0].state).toBe("returned");
    const [row] = await db.select().from(runs).where(eq(runs.id, fixture.root)); expect(row.status).toBe("failed"); expect(row.error).toContain("模型调用上限");
  }, 240_000);
  it("供应商失败后的 SDK 内部重试不能绕过限额，失败调用不退还", async () => {
    const fixture = await prepare(["不应再次调用"], { maxModelCalls: 1, maxChildRuns: 0 }, [503]);
    const definition = manifest({ first: { id: "first", title: "处理任务", type: "ai", next: "done" } }, fixture.agentId);
    const handle = await start(agentRunWorkflow, [fixture.root, definition, {}]); await expect(handle.returnValue).rejects.toThrow();
    expect(fixture.service.modelRequests).toHaveLength(1);
    const ledger = await db.select().from(modelCalls).where(eq(modelCalls.runId, fixture.root)); expect(ledger).toHaveLength(1); expect(ledger[0]).toMatchObject({ state: "failed", failure: "provider-unavailable", measurement: null });
    const [row] = await db.select().from(runs).where(eq(runs.id, fixture.root)); expect(row.status).toBe("failed"); expect(row.error).toContain("模型调用上限");
  }, 240_000);
  it.each(["agent_call", "handoff"] as const)("%s 子任务结束仍消费协作额度，第二次委派不能创建第二个子任务", async (kind) => {
    const fixture = await prepare(["协作处理完成"], { maxModelCalls: 10, maxChildRuns: 1 }), destination = await target();
    const delegate = (id: string, next: string) => ({ id, title: "协作处理", type: kind, next, ...(kind === "agent_call" ? { agentCall: { targetAgentId: destination.targetAgentId, versionId: destination.targetVersionId, outputContract: destination.outputContract } } : { toAgent: { id: destination.targetAgentId, name: "资源协作助手", versionId: destination.targetVersionId }, contract: {
      deliverables: ["处理结果"], mustNotInclude: ["密钥"], inputSchema: [{ name: "brief", type: "string", required: true }], outputSchema: [{ name: "first", type: "string", required: true }], memoryPolicy: { mode: "none", shared: [], private: ["密钥"] },
    } }) });
    const definition = manifest({ first: delegate("first", "second"), second: delegate("second", "done") }, fixture.agentId);
    const handle = await start(agentRunWorkflow, [fixture.root, definition, {}]); await expect(handle.returnValue).rejects.toThrow();
    const children = await db.select().from(runs).where(eq(runs.parentRunId, fixture.root)); expect(children).toHaveLength(1); expect(children[0]).toMatchObject({ status: "completed", executionRootRunId: fixture.root, executionResources: { limits: { maxChildRuns: 1 }, coverage: "new-root" }, result: { first: "协作处理完成" } });
    expect(fixture.service.modelRequests).toHaveLength(1); const [row] = await db.select().from(runs).where(eq(runs.id, fixture.root)); expect(row.status).toBe("failed"); expect(row.error).toContain("协作任务上限");
  }, 240_000);
  it("父子共享同一模型上限，父调用已用完时子任务在供应商调用前失败", async () => {
    const fixture = await prepare(["主任务已处理"], { maxModelCalls: 1, maxChildRuns: 1 }), destination = await target();
    const definition = manifest({ first: { id: "first", title: "主任务处理", type: "ai", next: "delegate" }, delegate: { id: "delegate", title: "协作处理", type: "agent_call", next: "done", agentCall: { targetAgentId: destination.targetAgentId, versionId: destination.targetVersionId, outputContract: destination.outputContract } } }, fixture.agentId);
    const handle = await start(agentRunWorkflow, [fixture.root, definition, {}]); await expect(handle.returnValue).rejects.toThrow();
    expect(fixture.service.modelRequests).toHaveLength(1); const children = await db.select().from(runs).where(eq(runs.parentRunId, fixture.root)); expect(children).toHaveLength(1); expect(children[0].status).toBe("failed"); expect(children[0].error).toContain("模型调用上限");
    expect(await db.select().from(modelCalls).where(eq(modelCalls.runId, children[0].id))).toHaveLength(0);
  }, 240_000);
});
