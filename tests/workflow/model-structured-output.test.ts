import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { start } from "workflow/api";
import { AgentManifest } from "@/contracts/manifest";
import { EvaluationCaseSnapshot } from "@/contracts/evaluation";
import { agentVersions, agents, auditEvents, evaluationCaseResults, evaluationCases, evaluationRuns, knowledgeChunks, knowledgeSources, modelCalls, runSteps, runs, traceEvents } from "@/db/schema";
import { KnowledgeReceipt } from "@/contracts/knowledge";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { agentRunWorkflow } from "@/server/workflows/agent-run";
import { getRunModelUsage } from "@/server/queries/model-usage";
import { getRunTaskResult } from "@/server/queries/run-tasks";
import { startModelJsonServer } from "../helpers/model-json-server";

let service: Awaited<ReturnType<typeof startModelJsonServer>> | undefined;
let runId: string | undefined;
let evaluationFixture: { agentId: string; versionId: string; caseId: string; evaluationId: string } | undefined;
let knowledgeFixtureIds: string[] = [];
let outputSelectionFixture: { agentId: string; versionId: string } | undefined;
const schema = {
  type: "object", required: ["amount", "approved"], additionalProperties: false,
  properties: { amount: { type: "number" }, approved: { type: "boolean" } },
};
afterEach(async () => {
  await service?.close();
  service = undefined;
  vi.unstubAllEnvs();
  if (knowledgeFixtureIds.length) {
    await db.delete(knowledgeChunks).where(inArray(knowledgeChunks.sourceId, knowledgeFixtureIds));
    await db.delete(knowledgeSources).where(inArray(knowledgeSources.id, knowledgeFixtureIds));
  }
  knowledgeFixtureIds = [];
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
  if (outputSelectionFixture) {
    await db.delete(agentVersions).where(eq(agentVersions.id, outputSelectionFixture.versionId));
    await db.delete(agents).where(eq(agents.id, outputSelectionFixture.agentId));
  }
  outputSelectionFixture = undefined;
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
    { mode: "root", missing: false }, { mode: "subflow", missing: false },
    { mode: "parallel", missing: false }, { mode: "parallel-issues", missing: false },
    { mode: "root", missing: true },
  ])("$mode 成果按冻结字段交付并由任务接口读取，缺失=$missing 不交付半成品", async ({ mode, missing }) => {
    const output = { rows: [{ ...(missing ? {} : { amount: 0 }), approved: false, email: "business@example.com" }], password: "test-credential-not-for-delivery", other: "未选择的中间业务内容" };
    const base = await prepare([JSON.stringify(output)]);
    const extract = { id: "extract", title: "提取业务对象", type: "ai", modelOutput: { format: "json", providerMode: "json", maxRepairAttempts: 0, schema: { type: "object" } } };
    const isParallel = mode.startsWith("parallel");
    const sourceNodeId = mode === "subflow" ? "group.extract" : isParallel ? "batch.work.extract" : "extract";
    const fields = [
      { path: "交付.金额", label: "订单金额", required: true, sourceNodeId, sourcePath: ["rows", "0", "amount"] },
      { path: "交付.批准", label: "业务决定", required: true, sourceNodeId, sourcePath: ["rows", "0", "approved"] },
      { path: "交付.邮箱", label: "业务邮箱", required: true, sourceNodeId, sourcePath: ["rows", "0", "email"] },
    ];
    const nodes: Record<string, unknown> = { done: base.workflowSnapshot.nodes.done };
    if (mode === "subflow") {
      nodes.start = { ...base.workflowSnapshot.nodes.start, next: "group" };
      nodes.group = { id: "group", title: "顺序提取", type: "subflow", next: "done", subflow: { name: "业务处理", steps: [extract] } };
    } else if (isParallel) {
      nodes.start = { ...base.workflowSnapshot.nodes.start, next: "batch" };
      nodes.batch = { id: "batch", title: "并行提取", type: "parallel", next: "done", parallel: { strategy: "all", failurePolicy: mode === "parallel-issues" ? "continue" : "fail_fast", branches: [
        { id: "work", label: "业务提取", steps: [extract] },
        { id: "other", label: "独立处理", steps: [{ id: "record", title: "独立记录", type: mode === "parallel-issues" ? "tool" : "system" }] },
      ] } };
    } else {
      nodes.start = { ...base.workflowSnapshot.nodes.start, next: "extract" };
      nodes.extract = { ...extract, next: "done" };
    }
    const manifest = AgentManifest.parse({ ...base, outputContract: { fields }, workflowSnapshot: { ...base.workflowSnapshot, nodes, outputContract: { fields } } });
    const agentId = crypto.randomUUID(), versionId = crypto.randomUUID();
    outputSelectionFixture = { agentId, versionId };
    await db.insert(agents).values({ id: agentId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, name: "字段交付助手", intentText: "提取订单金额并交付" });
    await db.insert(agentVersions).values({ id: versionId, agentId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, version: 1, manifest });
    await db.update(runs).set({ agentId, versionId }).where(eq(runs.id, runId!));
    const handle = await start(agentRunWorkflow, [runId!, manifest, {}]);
    if (missing) await expect(handle.returnValue).rejects.toThrow("缺少必需交付内容：订单金额");
    else await expect(handle.returnValue).resolves.toEqual({ status: "completed" });
    const [stored] = await db.select({ status: runs.status, result: runs.result, context: runs.context }).from(runs).where(eq(runs.id, runId!));
    const expected = { 交付: { 金额: 0, 批准: false, 邮箱: "business@example.com" } };
    expect(stored.status).toBe(missing ? "failed" : "completed");
    expect(stored.result).toEqual(missing ? null : expected);
    const presented = await getRunTaskResult(runId!, DEMO_WORKSPACE_ID);
    expect(presented).toMatchObject({ ready: true, status: missing ? "failed" : "completed", result: missing ? null : expected });
    expect(presented?.outputContract.fields).toEqual(fields);
    if (!missing) expect(JSON.stringify(stored.context)).toContain("未选择的中间业务内容");
    expect(JSON.stringify(presented)).not.toContain("test-credential-not-for-delivery");
    expect(JSON.stringify(presented)).not.toContain("未选择的中间业务内容");
    expect(service!.modelRequests).toHaveLength(1); expect(service!.toolRequests).toHaveLength(0);
    const steps = await db.select().from(runSteps).where(eq(runSteps.runId, runId!));
    expect(steps.find((step) => step.nodeId === sourceNodeId)?.status).toBe("succeeded");
  }, 240_000);

  it.each([
    { mode: "main", missing: false }, { mode: "subflow", missing: false },
    { mode: "parallel", missing: false }, { mode: "loop", missing: false },
    { mode: "after-subflow", missing: false }, { mode: "after-parallel", missing: false },
    { mode: "after-parallel-issues", missing: false },
    { mode: "main", missing: true },
  ])("实际模型提取主题后，$mode 知识映射保留冻结范围，缺失=$missing 时不回退原任务", async ({ mode, missing }) => {
    const output = missing ? { rows: [{ other: "未提供检索主题" }] } : { rows: [{ topic: "退货政策" }] };
    const base = await prepare([JSON.stringify(output)]);
    const sourceId = crypto.randomUUID(), outsideId = crypto.randomUUID();
    knowledgeFixtureIds = [sourceId, outsideId];
    for (const [id, name, content] of [
      [sourceId, "已发布售后手册", "退货政策：签收后七天内可退。"],
      [outsideId, "未发布私有手册", "退货政策：这段未发布资料不应被读取。"],
    ]) {
      await db.insert(knowledgeSources).values({ id, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, name, mime: "text/plain", sizeBytes: content.length, sha256: `mapped-knowledge-${id}`, status: "indexed", chunkCount: 1 });
      await db.insert(knowledgeChunks).values({ sourceId: id, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, chunkIndex: 0, content, charStart: 0, charEnd: content.length });
    }
    const isSubflow = mode === "subflow" || mode === "after-subflow";
    const isParallel = mode === "parallel" || mode === "after-parallel" || mode === "after-parallel-issues";
    const after = mode.startsWith("after-");
    const extractId = isSubflow ? "group.extract" : isParallel ? "batch.research.extract" : "extract";
    const lookupId = mode === "subflow" ? "group.lookup" : mode === "parallel" ? "batch.research.lookup" : "lookup";
    const extract = { id: "extract", title: "提取业务主题", type: "ai", modelOutput: { format: "json", providerMode: "json", maxRepairAttempts: 0, schema: { type: "object" } } };
    const lookup = { id: "lookup", title: "按业务主题查阅", type: "knowledge", knowledge: { space: "售后资料", query: "不应采用的固定主题", sourceIds: [sourceId] }, inputMapping: { fields: [
      { target: ["query"], source: { kind: "output", nodeId: mode === "loop" ? "for_rows" : extractId, path: mode === "loop" ? ["currentItem", "topic"] : ["rows", "0", "topic"] } },
      { target: ["sourceIds"], source: { kind: "literal", value: [outsideId] } },
    ] } };
    const nodes: Record<string, unknown> = { done: base.workflowSnapshot.nodes.done };
    if (isSubflow) {
      nodes.start = { ...base.workflowSnapshot.nodes.start, next: "group" };
      nodes.group = { id: "group", title: "顺序检索", type: "subflow", next: after ? "lookup" : "done", subflow: { name: "提取并检索", steps: after ? [extract] : [extract, lookup] } };
      if (after) nodes.lookup = { ...lookup, next: "done" };
    } else if (isParallel) {
      nodes.start = { ...base.workflowSnapshot.nodes.start, next: "batch" };
      nodes.batch = { id: "batch", title: "并行处理", type: "parallel", next: after ? "lookup" : "done", parallel: { strategy: "all", failurePolicy: mode === "after-parallel-issues" ? "continue" : "fail_fast", branches: [
        { id: "research", label: "提取并检索", steps: after ? [extract] : [extract, lookup] },
        { id: "record", label: "独立记录", steps: [{ id: "record", title: "记录处理", type: mode === "after-parallel-issues" ? "tool" : "system" }] },
      ] } };
      if (after) nodes.lookup = { ...lookup, next: "done" };
    } else {
      nodes.start = { ...base.workflowSnapshot.nodes.start, next: "extract" };
      nodes.extract = { ...extract, next: mode === "loop" ? "for_rows" : "lookup" };
      nodes.lookup = { ...lookup, next: mode === "loop" ? "for_rows" : "done" };
      if (mode === "loop") nodes.for_rows = { id: "for_rows", title: "逐项查阅", type: "loop", loop: { collectionPath: "context.outputs.extract.rows", itemKey: "row", maxIterations: 1, bodyNext: "lookup", exitNext: "done" } };
    }
    const manifest = AgentManifest.parse({ ...base, workflowFingerprint: "mapped-knowledge-test", knowledgeSnapshot: [sourceId], workflowSnapshot: { ...base.workflowSnapshot, nodes } });
    const input = { query: "退货政策" };
    await db.update(runs).set({ input }).where(eq(runs.id, runId!));
    const handle = await start(agentRunWorkflow, [runId!, manifest, input]);
    if (missing) await expect(handle.returnValue).rejects.toThrow("缺少映射字段");
    else await expect(handle.returnValue).resolves.toEqual({ status: "completed" });
    const [storedRun] = await db.select({ status: runs.status, result: runs.result }).from(runs).where(eq(runs.id, runId!));
    expect(storedRun?.status).toBe(missing ? "failed" : "completed");
    if (missing) expect(storedRun?.result).toBeNull();
    expect(service!.modelRequests).toHaveLength(1);
    expect(service!.toolRequests).toHaveLength(0);
    const steps = await db.select().from(runSteps).where(eq(runSteps.runId, runId!));
    const step = steps.find((entry) => entry.nodeId === lookupId);
    expect(step?.status).toBe(missing ? "failed" : "succeeded");
    if (missing) expect(step?.error).toContain("缺少映射字段");
    else {
      const receipt = KnowledgeReceipt.parse(step?.output);
      expect(receipt).toMatchObject({ query: "退货政策", scannedCount: 1, hitCount: 1 });
      expect(receipt.hits.map((hit) => hit.source)).toEqual(["已发布售后手册"]);
      expect(JSON.stringify(receipt)).not.toContain("未发布私有手册");
    }
    const traces = await db.select().from(traceEvents).where(eq(traceEvents.runId, runId!));
    expect(traces.filter((trace) => trace.nodeId === lookupId && trace.kind === "knowledge.receipt")).toHaveLength(Number(!missing));
  }, 240_000);

  it.each([
    { label: "肯定值不是金额", amount: true, threshold: 1, writes: false },
    { label: "否定值不能冒充零金额", amount: false, threshold: 0, writes: false },
    { label: "空数组不能冒充零金额", amount: [], threshold: 0, writes: false },
    { label: "单元素数组不是金额", amount: [100], threshold: 100, writes: false },
    { label: "对象不是金额", amount: { amount: 100 }, threshold: 100, writes: false },
    { label: "数字文字仍可比较", amount: "100", threshold: 100, writes: true },
    { label: "真实零金额不丢失", amount: 0, threshold: 0, writes: true },
  ])("数值分流 $label 时，只为真实匹配调用业务写入工具", async ({ amount, threshold, writes }) => {
    const base = await prepare([]);
    const manifest = AgentManifest.parse({
      ...base, workflowFingerprint: "numeric-condition-test",
      workflowSnapshot: { ...base.workflowSnapshot, nodes: {
        start: { ...base.workflowSnapshot.nodes.start, next: "choose" },
        choose: { ...base.workflowSnapshot.nodes.choose, condition: {
          source: "input.amount", operator: "gte",
          branches: [{ label: "金额符合条件", value: threshold, next: "record" }], defaultNext: "low_amount",
        } },
        record: base.workflowSnapshot.nodes.record,
        low_amount: base.workflowSnapshot.nodes.low_amount,
        done: base.workflowSnapshot.nodes.done,
      } },
    });
    const input = { amount };
    await db.update(runs).set({ input }).where(eq(runs.id, runId!));
    const handle = await start(agentRunWorkflow, [runId!, manifest, input]);
    await expect(handle.returnValue).resolves.toEqual({ status: "completed" });
    expect(service!.modelRequests).toHaveLength(0);
    expect(service!.toolRequests).toHaveLength(Number(writes));
    const [completed] = await db.select().from(runs).where(eq(runs.id, runId!));
    expect(completed).toMatchObject({ status: "completed", result: { choose: { matched: writes ? "金额符合条件" : "默认分支", next: writes ? "record" : "low_amount" } } });
    const steps = await db.select().from(runSteps).where(eq(runSteps.runId, runId!));
    expect(steps.some((step) => step.nodeId === "record")).toBe(writes);
    expect(steps.some((step) => step.nodeId === "low_amount")).toBe(!writes);
    if (writes) expect(service!.toolRequests[0]).toMatchObject({ input });
  }, 240_000);

  it.each([
    { label: "零金额和否定值符合业务预期", amount: 0, approved: false, passed: true, schemaOnly: false },
    { label: "格式正确但业务值不符", amount: 10, approved: true, passed: false, schemaOnly: false },
    { label: "只有结果规则且金额在范围内", amount: 50, approved: false, passed: true, schemaOnly: true },
    { label: "模型格式有效但超出业务金额范围", amount: 101, approved: false, passed: false, schemaOnly: true },
  ])("实际模型返回订单数组，$label 时正确执行验收上线门禁", async ({ amount, approved, passed, schemaOnly }) => {
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
    const snapshot = EvaluationCaseSnapshot.parse({ name: "订单数组验收", input: {}, expectations: schemaOnly ? [] : [
      { path: "extract.items.0.amount", operator: "equals", value: 0 },
      { path: "extract.items.0.approved", operator: "equals", value: false },
      { path: "extract.items.0.labels.0", operator: "contains", value: "到货" },
    ], ...(schemaOnly ? { resultSchema: {
      type: "object", required: ["extract"], properties: { extract: {
        type: "object", required: ["items"], properties: { items: {
          type: "array", minItems: 1, maxItems: 1, items: { type: "object", required: ["amount"], properties: { amount: { type: "number", minimum: 0, maximum: 100 } } },
        } },
      } },
    } } : {}) });
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
    else expect(outcome.error).toContain(schemaOnly ? "结果.extract.items[0].amount" : "extract.items.0.");
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
