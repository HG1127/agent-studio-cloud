import { and, eq, inArray, like } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { start } from "workflow/api";
import { AgentManifest } from "@/contracts/manifest";
import { agents, agentVersions, runs, runSteps, traceEvents } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { agentRunWorkflow } from "@/server/workflows/agent-run";
import { startModelJsonServer } from "../helpers/model-json-server";

let service: Awaited<ReturnType<typeof startModelJsonServer>> | undefined;
let parentRunId: string | undefined;
let targetAgentId: string | undefined;
let targetVersionId: string | undefined;
let sourcePrefix: string;

async function children() {
  if (!parentRunId) return [];
  return db.select().from(runs).where(and(
    eq(runs.workspaceId, DEMO_WORKSPACE_ID), like(runs.sourceKey, sourcePrefix + ":" + parentRunId + ":%"),
  ));
}
afterEach(async () => {
  await service?.close();
  service = undefined;
  vi.unstubAllEnvs();
  const runIds = [...(await children()).map((row) => row.id), ...(parentRunId ? [parentRunId] : [])];
  if (runIds.length) {
    await db.delete(traceEvents).where(inArray(traceEvents.runId, runIds));
    await db.delete(runSteps).where(inArray(runSteps.runId, runIds));
    await db.delete(runs).where(inArray(runs.id, runIds));
  }
  if (targetVersionId) await db.delete(agentVersions).where(eq(agentVersions.id, targetVersionId));
  if (targetAgentId) await db.delete(agents).where(eq(agents.id, targetAgentId));
  parentRunId = targetAgentId = targetVersionId = undefined;
});

async function prepare(kind: "agent_call" | "handoff", failure?: "missing" | "wrong-type" | "private-memory", team = false) {
  service = await startModelJsonServer([]);
  targetAgentId = crypto.randomUUID();
  targetVersionId = crypto.randomUUID();
  sourcePrefix = kind === "agent_call" ? "agent-call" : "handoff";
  const tool = {
    id: "collaboration-mapping-test", name: "记录核对金额", description: "隔离测试",
    endpoint: service.baseUrl + "/invoke", action: "record", scope: "test.record", risk: "low",
    inputSchema: { type: "object" }, outputSchema: { type: "object" },
  };
  vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify([tool]));
  const inputContract = { fields: [
    { name: "amount", type: "number", required: true },
    { name: "approved", type: "boolean", required: true },
    { name: "customer", type: "object", required: true },
    { name: "brief", type: "string", required: false },
  ] };
  const outputContract = { fields: [{ path: "record", label: "订单回执", required: true, sourceNodeId: "record" }] };
  const target = AgentManifest.parse({
    schemaVersion: "4.0", workflowFingerprint: "collaboration-mapping-target", inputContract, outputContract,
    resourceSelection: { model: { modelId: "mock", mock: true } },
    designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
    workflowSnapshot: {
      id: "collaboration-mapping-target", startNodeId: "start", outputContract,
      rootAgent: { id: targetAgentId, name: "订单处理助手", role: "处理" }, memoryPolicy: { taskContext: true, longTerm: false },
      nodes: {
        start: { id: "start", title: "收到业务字段", type: "trigger", next: "choose" },
        choose: { id: "choose", title: "按金额判断", type: "condition", condition: {
          source: "input.amount", operator: "gte", branches: [{ label: "金额达到阈值", value: 100, next: "record" }], defaultNext: "done",
        } },
        record: { id: "record", title: "记录核对金额", type: "tool", next: "done", tool: {
          connector: "test", action: "record", scope: "test.record", risk: "low", registryToolId: tool.id, protocol: "http-json",
          inputSchema: tool.inputSchema, outputSchema: tool.outputSchema,
        }, inputMapping: { fields: [
          { target: ["customerId"], source: { kind: "input", path: ["customer", "id"] } },
          { target: ["amount"], source: { kind: "input", path: ["amount"] } },
          { target: ["approved"], source: { kind: "input", path: ["approved"] } },
        ] } },
        done: { id: "done", title: "完成", type: "end" },
      },
    },
  });
  await db.insert(agents).values({
    id: targetAgentId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
    name: "订单处理助手", intentText: "核对业务字段", status: "published",
  });
  await db.insert(agentVersions).values({
    id: targetVersionId, agentId: targetAgentId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
    version: 1, status: "production", manifest: target,
  });
  const delegate = {
    id: "delegate", title: "交给订单处理助手", type: kind, next: "done", ...(failure ? { onErrorNext: "fallback" } : {}),
    ...(kind === "agent_call" ? { agentCall: {
      targetAgentId, versionId: targetVersionId, inputContract, outputContract, memoryAccess: { mode: team ? "team" : "none" },
    } } : { toAgent: { id: targetAgentId, name: "订单处理助手", versionId: targetVersionId }, contract: {
      deliverables: ["订单回执"], mustNotInclude: ["密钥", "内部备注"],
      inputSchema: inputContract.fields.map((field) => ({ ...field })),
      outputSchema: [{ name: "record", type: "object", required: true }],
      memoryPolicy: { mode: team ? "team" : "none", shared: [], private: ["内部草稿"] },
    } }),
    inputMapping: { fields: [
      { target: ["amount"], source: failure === "missing" || failure === "wrong-type"
        ? { kind: "input", path: [failure === "missing" ? "missing" : "wrongAmount"] }
        : { kind: "output", nodeId: "extract", path: ["amount"] } },
      { target: ["approved"], source: { kind: "output", nodeId: "extract", path: ["approved"] } },
      { target: ["customer", "id"], source: { kind: "input", path: ["customer", "id"] } },
      ...(failure === "private-memory" ? [{ target: ["brief"], source: { kind: "output", nodeId: "extract", path: ["nested", "memories", "0", "content"] } }] : []),
    ] },
  };
  const parentId = crypto.randomUUID();
  const parent = AgentManifest.parse({
    schemaVersion: "4.0", workflowFingerprint: "collaboration-mapping-parent", inputContract: { fields: [] },
    resourceSelection: { model: { modelId: "mock", mock: true } },
    designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
    workflowSnapshot: {
      id: "collaboration-mapping-parent", startNodeId: "start",
      rootAgent: { id: parentId, name: "业务统筹助手", role: "统筹" }, memoryPolicy: { taskContext: true, longTerm: false },
      nodes: {
        start: { id: "start", title: "收到任务", type: "trigger", next: "extract" },
        extract: { id: "extract", title: "整理业务字段", type: "ai", next: "delegate", modelOutput: {
          format: "json", schema: { type: "object", properties: { amount: { type: "number" }, approved: { type: "boolean" } }, required: ["amount", "approved"] },
          mockOutput: { amount: 123.5, approved: false, nested: { mode: "read", memories: [{ content: "team-memory-content" }] } },
        } },
        delegate,
        ...(failure ? { fallback: { id: "fallback", title: "转员工补充业务输入", type: "system", next: "done" } } : {}),
        done: { id: "done", title: "完成", type: "end" },
      },
    },
  });
  const input = { customer: { id: "c1", 内部备注: "not-selected" }, secretNote: "not-selected", wrongAmount: "not-a-number" };
  const [run] = await db.insert(runs).values({
    agentId: parentId, versionId: crypto.randomUUID(), workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
    status: "queued", input,
  }).returning({ id: runs.id });
  parentRunId = run.id;
  return start(agentRunWorkflow, [run.id, parent, input]);
}

describe("真实多助手业务字段映射", () => {
  it.each(["agent_call", "handoff"] as const)("%s 把数字布尔与嵌套字段准确传给冻结子运行，驱动条件和 HTTP 工具", async (kind) => {
    const handle = await prepare(kind);
    await expect(handle.returnValue).resolves.toEqual({ status: "completed" });
    const childRows = await children();
    expect(childRows).toHaveLength(1);
    expect(childRows[0]).toMatchObject({ versionId: targetVersionId, status: "completed", input: { amount: 123.5, approved: false, customer: { id: "c1" } } });
    expect(childRows[0].input).toEqual({ amount: 123.5, approved: false, customer: { id: "c1" } });
    expect(service!.toolRequests).toEqual([{ action: "record", input: { customerId: "c1", amount: 123.5, approved: false }, outputs: {} }]);
    const [finished] = await db.select().from(runs).where(eq(runs.id, parentRunId!));
    expect(finished.result).toMatchObject({ delegate: { status: "completed", result: { record: { ok: true } } } });
  }, 240_000);
  it.each([
    { kind: "agent_call", failure: "missing" }, { kind: "handoff", failure: "missing" },
    { kind: "agent_call", failure: "wrong-type" }, { kind: "handoff", failure: "wrong-type" },
  ] as const)("$kind 的 $failure 输入在创建子运行前拦截，并进入备用处理", async ({ kind, failure }) => {
    const handle = await prepare(kind, failure);
    await expect(handle.returnValue).resolves.toEqual({ status: "completed" });
    expect(await children()).toHaveLength(0);
    expect(service!.toolRequests).toHaveLength(0);
    const [finished] = await db.select().from(runs).where(eq(runs.id, parentRunId!));
    expect(finished.result).toMatchObject({ delegate: { status: "failed", error: expect.stringContaining(failure === "missing" ? "缺少映射字段" : "格式不正确") }, fallback: expect.any(Object) });
  }, 240_000);
  it.each(["agent_call", "handoff"] as const)("%s 的私有模式拒绝嵌套经验来源，团队模式才允许映射到子运行", async (kind) => {
    const handle = await prepare(kind, "private-memory");
    await expect(handle.returnValue).resolves.toEqual({ status: "completed" });
    expect(await children()).toHaveLength(0);
    expect(service!.toolRequests).toHaveLength(0);
  }, 240_000);
  it.each(["agent_call", "handoff"] as const)("%s 的团队模式可以显式共享嵌套经验，不自动携带其他上下文", async (kind) => {
    const handle = await prepare(kind, "private-memory", true);
    await expect(handle.returnValue).resolves.toEqual({ status: "completed" });
    const childRows = await children();
    expect(childRows).toHaveLength(1);
    expect(childRows[0].input).toEqual({ amount: 123.5, approved: false, customer: { id: "c1" }, brief: "team-memory-content" });
    expect(JSON.stringify(childRows[0].input)).not.toContain("not-selected");
  }, 240_000);
});
