import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { start } from "workflow/api";
import { AgentManifest } from "@/contracts/manifest";
import { EvaluationCaseSnapshot } from "@/contracts/evaluation";
import { agentVersions, agents, auditEvents, evaluationCaseResults, evaluationCases, evaluationRuns, modelCalls, runSteps, runs, traceEvents } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { agentRunWorkflow } from "@/server/workflows/agent-run";
import { getRunModelUsage } from "@/server/queries/model-usage";
import { startModelJsonServer } from "../helpers/model-json-server";

let service: Awaited<ReturnType<typeof startModelJsonServer>> | undefined;
let runId: string | undefined;
let evaluationFixture: { agentId: string; versionId: string; caseId: string; evaluationId: string } | undefined;
const schema = {
  type: "object", required: ["amount", "approved"], additionalProperties: false,
  properties: { amount: { type: "number" }, approved: { type: "boolean" } },
};
afterEach(async () => {
  await service?.close();
  service = undefined;
  vi.unstubAllEnvs();
  if (evaluationFixture) {
    const { agentId, versionId, caseId, evaluationId } = evaluationFixture;
    await db.delete(evaluationCaseResults).where(eq(evaluationCaseResults.evaluationRunId, evaluationId));
    await db.delete(evaluationRuns).where(eq(evaluationRuns.id, evaluationId));
    await db.delete(evaluationCases).where(eq(evaluationCases.id, caseId));
    await db.delete(agentVersions).where(eq(agentVersions.id, versionId));
    await db.delete(agents).where(eq(agents.id, agentId));
    await db.delete(auditEvents).where(inArray(auditEvents.targetId, [agentId, versionId, caseId, evaluationId]));
  }
  evaluationFixture = undefined;
  if (runId) {
    await db.delete(traceEvents).where(eq(traceEvents.runId, runId));
    await db.delete(runSteps).where(eq(runSteps.runId, runId));
    await db.delete(runs).where(eq(runs.id, runId));
  }
  runId = undefined;
});

async function prepare(replies: string[], mock = false) {
  service = await startModelJsonServer(replies);
  vi.stubEnv("MODEL_BASE_URL", service.baseUrl + "/v1");
  vi.stubEnv("MODEL_API_KEY", "test-workflow-only-key");
  vi.stubEnv("MODEL_ID", "test-model");
  vi.stubEnv("REAL_MODELS_ENABLED", "1");
  const tool = {
    id: "structured-output-test", name: "记录已核对金额", description: "测试",
    endpoint: service.baseUrl + "/invoke", action: "record_amount", scope: "test.record", risk: "low",
    inputSchema: { type: "object" }, outputSchema: { type: "object" },
  };
  vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify([tool]));
  const manifest = AgentManifest.parse({
    schemaVersion: "4.0", workflowFingerprint: "structured-output-test",
    inputContract: { fields: [] },
    resourceSelection: { model: { modelId: "test-model", mock } },
    designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
    workflowSnapshot: {
      id: "structured-output-test", startNodeId: "start",
      rootAgent: { id: "test", name: "金额处理助手", role: "测试" },
      memoryPolicy: { taskContext: true, longTerm: false },
      nodes: {
        start: { id: "start", title: "收到任务", type: "trigger", next: "extract" },
        extract: {
          id: "extract", title: "提取金额", type: "ai", next: "choose",
          modelOutput: { format: "json", schema, providerMode: "json-schema", maxRepairAttempts: 1, ...(mock ? { mockOutput: { amount: 10, approved: false } } : {}) },
        },
        choose: {
          id: "choose", title: "按金额分流", type: "condition",
          condition: {
            source: "context.outputs.extract.amount", operator: "gte",
            branches: [{ label: "超过阈值", value: 100, next: "record" }], defaultNext: "low_amount",
          },
        },
        record: {
          id: "record", title: "记录金额", type: "tool", next: "done",
          tool: { connector: "test", action: "record_amount", scope: "test.record", risk: "low", registryToolId: tool.id, protocol: "http-json", inputSchema: tool.inputSchema, outputSchema: tool.outputSchema },
        },
        low_amount: { id: "low_amount", title: "记录低金额事项", type: "system", next: "done", system: { kind: "record" } },
        done: { id: "done", title: "完成", type: "end", next: null },
      },
    },
  });
  const [run] = await db.insert(runs).values({
    agentId: crypto.randomUUID(), versionId: crypto.randomUUID(),
    workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, status: "queued", input: {},
  }).returning({ id: runs.id });
  runId = run.id;
  return manifest;
}

describe("持久工作流的结构化业务结果", () => {
  it.each([
    { label: "零金额和否定值符合业务预期", amount: 0, approved: false, passed: true },
    { label: "格式正确但业务值不符", amount: 10, approved: true, passed: false },
  ])("实际模型返回订单数组，$label 时正确执行验收上线门禁", async ({ amount, approved, passed }) => {
    const output = { items: [{ amount, approved, labels: ["到货确认"] }] };
    const base = await prepare([JSON.stringify(output)]);
    const manifest = AgentManifest.parse({
      ...base, workflowFingerprint: "array-evaluation-test",
      workflowSnapshot: { ...base.workflowSnapshot, nodes: {
        start: base.workflowSnapshot.nodes.start,
        extract: { ...base.workflowSnapshot.nodes.extract, next: "done", modelOutput: {
          format: "json", providerMode: "json-schema", maxRepairAttempts: 0,
          schema: {
            type: "object", required: ["items"], additionalProperties: false,
            properties: { items: { type: "array", minItems: 1, items: {
              type: "object", required: ["amount", "approved", "labels"], additionalProperties: false,
              properties: { amount: { type: "number" }, approved: { type: "boolean" }, labels: { type: "array", items: { type: "string" } } },
            } } },
          },
        } },
        done: base.workflowSnapshot.nodes.done,
      } },
    });
    const [run] = await db.select({ agentId: runs.agentId, versionId: runs.versionId }).from(runs).where(eq(runs.id, runId!));
    const caseId = crypto.randomUUID(), evaluationId = crypto.randomUUID();
    evaluationFixture = { agentId: run.agentId, versionId: run.versionId, caseId, evaluationId };
    const snapshot = EvaluationCaseSnapshot.parse({ name: "订单数组验收", input: {}, expectations: [
      { path: "extract.items.0.amount", operator: "equals", value: 0 },
      { path: "extract.items.0.approved", operator: "equals", value: false },
      { path: "extract.items.0.labels.0", operator: "contains", value: "到货" },
    ] });
    const owner = { workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID };
    await db.insert(agents).values({ ...owner, id: run.agentId, name: "订单数组验收助手", intentText: "按业务字段验收订单明细" });
    await db.insert(agentVersions).values({ ...owner, id: run.versionId, agentId: run.agentId, version: 1, status: "candidate", manifest });
    await db.insert(evaluationCases).values({ ...owner, id: caseId, agentId: run.agentId, ...snapshot });
    await db.insert(evaluationRuns).values({ ...owner, id: evaluationId, agentId: run.agentId, versionId: run.versionId, requestId: crypto.randomUUID(), totalCount: 1 });
    await db.insert(evaluationCaseResults).values({ ...owner, evaluationRunId: evaluationId, evaluationCaseId: caseId, runId, caseSnapshot: snapshot });
    await db.update(runs).set({ sourceType: "evaluation", sourceKey: `evaluation:${evaluationId}:${caseId}` }).where(eq(runs.id, runId!));
    const handle = await start(agentRunWorkflow, [runId!, manifest, {}]);
    await expect(handle.returnValue).resolves.toEqual({ status: "completed" });
    expect(service!.modelRequests).toHaveLength(1);
    expect(service!.toolRequests).toHaveLength(0);
    const [completed] = await db.select().from(runs).where(eq(runs.id, runId!));
    expect(completed).toMatchObject({ status: "completed", result: { extract: output } });
    const [outcome] = await db.select().from(evaluationCaseResults).where(eq(evaluationCaseResults.evaluationRunId, evaluationId));
    expect(outcome).toMatchObject({ status: passed ? "passed" : "failed", caseSnapshot: snapshot, runId });
    if (passed) expect(outcome.error).toBeNull();
    else expect(outcome.error).toContain("extract.items.0.");
    const [summary] = await db.select().from(evaluationRuns).where(eq(evaluationRuns.id, evaluationId));
    expect(summary).toMatchObject({ status: "completed", totalCount: 1, passedCount: Number(passed), failedCount: Number(!passed) });
    const [version] = await db.select().from(agentVersions).where(eq(agentVersions.id, run.versionId));
    expect(version.status).toBe(passed ? "production" : "candidate");
  }, 240_000);

  it("实际 SDK 修正字段后，以数字驱动分支并把对象传给真实 HTTP 工具", async () => {
    const manifest = await prepare(['{"amount":123.5,"approved":true,"sk-private-field-name":"private-field-value"}', '{"amount":123.5,"approved":true}']);
    const handle = await start(agentRunWorkflow, [runId!, manifest, {}]);
    await expect(handle.returnValue).resolves.toEqual({ status: "completed" });
    expect(service!.modelRequests).toHaveLength(2);
    expect(await getRunModelUsage(DEMO_WORKSPACE_ID, runId!)).toMatchObject({ tracking: "tracked-v1", calls: { total: 2, returned: 2, failed: 0, pending: 0 }, usage: { completeCalls: 2, knownInputTokens: 24, knownOutputTokens: 12, knownCallTotalTokens: 36, recordedUsageComplete: true } });
    const calls = await db.select().from(modelCalls).where(eq(modelCalls.runId, runId!));
    expect(calls).toHaveLength(2); expect(new Set(calls.map((call) => call.id)).size).toBe(2);
    expect(JSON.stringify(calls)).not.toMatch(/sk-private-field-name|private-field-value/);
    expect(service!.toolRequests).toEqual([expect.objectContaining({ outputs: { extract: { amount: 123.5, approved: true }, choose: expect.any(Object) } })]);
    const [completed] = await db.select().from(runs).where(eq(runs.id, runId!));
    expect(completed.result).toMatchObject({ extract: { amount: 123.5, approved: true }, record: { ok: true } });
    const steps = await db.select().from(runSteps).where(eq(runSteps.runId, runId!));
    expect(steps.find((step) => step.nodeId === "extract")).toMatchObject({
      status: "succeeded", output: { output: { amount: 123.5, approved: true }, usage: { inputTokens: 24, outputTokens: 12 }, repairCount: 1, mock: false },
    });
    expect(steps.some((step) => step.nodeId === "low_amount")).toBe(false);
    const traces = await db.select().from(traceEvents).where(eq(traceEvents.runId, runId!));
    expect(JSON.stringify({ completed, steps, traces })).not.toContain("sk-private-field-name");
    expect(JSON.stringify({ completed, steps, traces })).not.toContain("private-field-value");
  }, 240_000);

  it("结果校验耗尽修正次数后结束失败，绝不调用下游写入工具或保存错误正文", async () => {
    const manifest = await prepare(['{"amount":"sk-private-invalid-output","approved":true}']);
    const handle = await start(agentRunWorkflow, [runId!, manifest, {}]);
    await expect(handle.returnValue).rejects.toThrow("模型结果未满足字段契约");
    await vi.waitFor(async () => {
      const [failed] = await db.select({ status: runs.status }).from(runs).where(eq(runs.id, runId!));
      expect(failed?.status).toBe("failed");
    }, { timeout: 30_000, interval: 500 });
    expect(service!.modelRequests).toHaveLength(2);
    expect(service!.toolRequests).toHaveLength(0);
    expect(await getRunModelUsage(DEMO_WORKSPACE_ID, runId!)).toMatchObject({ calls: { total: 2, returned: 2 }, usage: { knownCallTotalTokens: 36, recordedUsageComplete: true } });
    const [failed] = await db.select().from(runs).where(eq(runs.id, runId!));
    const steps = await db.select().from(runSteps).where(eq(runSteps.runId, runId!));
    const traces = await db.select().from(traceEvents).where(eq(traceEvents.runId, runId!));
    expect(failed.status).toBe("failed");
    expect(steps.find((step) => step.nodeId === "extract")).toMatchObject({ status: "failed", output: { usage: { inputTokens: 24, outputTokens: 12 }, repairCount: 1, mock: false } });
    expect(JSON.stringify({ failed, steps, traces })).not.toContain("sk-private-invalid-output");
  }, 240_000);

  it("显式模拟对象保持数字类型，走对应分支且不用模型或外部写入", async () => {
    const manifest = await prepare([], true);
    const handle = await start(agentRunWorkflow, [runId!, manifest, {}]);
    await expect(handle.returnValue).resolves.toEqual({ status: "completed" });
    expect(service!.modelRequests).toHaveLength(0);
    expect(await getRunModelUsage(DEMO_WORKSPACE_ID, runId!)).toMatchObject({ tracking: "tracked-v1", calls: { total: 0 }, usage: { knownInputTokens: null, knownOutputTokens: null, knownCallTotalTokens: null, recordedUsageComplete: true } });
    expect(service!.toolRequests).toHaveLength(0);
    const [completed] = await db.select().from(runs).where(eq(runs.id, runId!));
    expect(completed.result).toMatchObject({ extract: { amount: 10, approved: false }, low_amount: expect.any(Object) });
    const steps = await db.select().from(runSteps).where(eq(runSteps.runId, runId!));
    expect(steps.find((step) => step.nodeId === "extract")).toMatchObject({ output: { output: { amount: 10, approved: false }, repairCount: 0, mock: true } });
  }, 240_000);
});
