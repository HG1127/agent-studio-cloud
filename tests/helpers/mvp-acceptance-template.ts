import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { vi } from "vitest";
import { MvpTemplateInput } from "@/contracts/mvp-template";
import { agents, agentVersions, approvals, attentionCases, auditEvents, evaluationCaseResults, evaluationCases, evaluationRuns, modelCalls, runDeliveries, runFeedback, runs, runSteps, toolOperations, traceEvents, workflowDefinitions } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { cancelRunAction } from "@/server/actions/cancel-run";
import { buildMvpTemplate } from "@/server/domain/mvp-template";
import { listToolRegistryOptions, parseToolRegistry } from "@/server/tools/tool-registry";
import { MvpAcceptanceProposalSchema, MvpAcceptanceReceiptSchema, startMvpAcceptanceTools } from "./mvp-acceptance-tools";
import { startModelJsonServer } from "./model-json-server";

export function assertMvpAcceptanceIsolatedDb() {
  if (process.env.MVP_ACCEPTANCE_ISOLATED_DB !== "1") throw new Error("仅 CI/CD 专用临时隔离库允许执行生产模板验收");
}

export async function prepareMvpAcceptanceTemplate(replies = ['{"customerId":"c1","amount":0,"approved":false}']) {
  assertMvpAcceptanceIsolatedDb();
  const tools = await startMvpAcceptanceTools();
  let model: Awaited<ReturnType<typeof startModelJsonServer>> | undefined;
  try {
    model = await startModelJsonServer(replies);
    const registry = parseToolRegistry(JSON.stringify([
      { id: "acceptance.customer.read", name: "查询客户", action: "lookup_customer", scope: "customers", risk: "low",
        endpoint: tools.readEndpoint, protocol: "mcp-streamable-http", operationKind: "read",
        inputSchema: tools.readSchema, outputSchema: { type: "object", required: ["customerId", "amount", "active"], additionalProperties: false,
          properties: { customerId: { type: "string" }, amount: { type: "number" }, active: { type: "boolean" } } } },
      { id: "acceptance.customer.record", name: "登记客户方案", action: "record_proposal", scope: "customers", risk: "high",
        endpoint: tools.writeEndpoint, protocol: "mcp-streamable-http", operationKind: "action", businessIdempotency: true,
        businessIdempotencyRetentionMs: 86_400_000, inputSchema: MvpAcceptanceProposalSchema, outputSchema: MvpAcceptanceReceiptSchema,
        headers: { authorization: "Bearer test-acceptance-registry-only" } },
    ]));
    if (registry.length !== 2) throw new Error("生产模板验收登记配置无效");
    vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify(registry));
    vi.stubEnv("MODEL_BASE_URL", model.baseUrl + "/v1");
    vi.stubEnv("MODEL_API_KEY", "test-template-model-only-key");
    vi.stubEnv("MODEL_ID", "test-model");
    vi.stubEnv("MODEL_MOCK", "0");
    vi.stubEnv("REAL_MODELS_ENABLED", "1");
    vi.stubEnv("HARNESS_POLICY_JSON", "");
    vi.stubEnv("HARNESS_MAX_PROMPT_CHARS", "");
    const spec = MvpTemplateInput.parse({
      name: "生产模板验收助手", businessGoal: "读取客户事实并拟定可审核方案，批准后登记业务回执",
      businessRules: "只使用客户资料中的事实，保留零金额和否定值，业务负责人批准后才登记方案",
      approvalRole: "业务负责人", inputs: [{ name: "customerId", label: "客户编号", type: "string" }, { name: "requestId", label: "业务防重编号", type: "string" }],
      operationKeyInput: "requestId", readToolId: registry[0].id, actionToolId: registry[1].id,
      readMapping: { fields: [{ target: ["customerId"], source: { kind: "input", path: ["customerId"] }, required: true }] },
      actionMapping: { fields: ["customerId", "amount", "approved"].map((field) => ({ target: [field], source: { kind: "output", nodeId: "plan", path: [field] }, required: true })) },
      deliverables: [{ field: "receiptId", label: "业务回执" }, { field: "amount", label: "金额" }, { field: "approved", label: "方案标记" }],
    });
    const built = buildMvpTemplate(spec, listToolRegistryOptions());
    if (!built.ok) throw new Error(`生产模板工厂拒绝：${built.error}`);
    return { agentId: randomUUID(), input: { customerId: "c1", requestId: randomUUID() }, spec, built, registry, tools, model };
  } catch (error) {
    await tools.close();
    await model?.close();
    vi.unstubAllEnvs();
    throw error;
  }
}
export type MvpAcceptanceTemplateContext = Awaited<ReturnType<typeof prepareMvpAcceptanceTemplate>>;

export async function cleanupMvpAcceptanceTemplate(context: MvpAcceptanceTemplateContext) {
  assertMvpAcceptanceIsolatedDb();
  const owner = and(eq(agents.id, context.agentId), eq(agents.workspaceId, DEMO_WORKSPACE_ID));
  try {
    const ownRuns = await db.select().from(runs).where(and(eq(runs.agentId, context.agentId), eq(runs.workspaceId, DEMO_WORKSPACE_ID)));
    for (const run of ownRuns) {
      if (!["completed", "failed", "cancelled"].includes(run.status)) {
        const cancelled = await cancelRunAction(run.id);
        if (!cancelled.ok) throw new Error(`无法停止本套件运行：${cancelled.error}`);
      }
    }
    const runIds = ownRuns.map((run) => run.id);
    const versions = await db.select({ id: agentVersions.id }).from(agentVersions).where(and(eq(agentVersions.agentId, context.agentId), eq(agentVersions.workspaceId, DEMO_WORKSPACE_ID)));
    const cases = await db.select({ id: evaluationCases.id }).from(evaluationCases).where(and(eq(evaluationCases.agentId, context.agentId), eq(evaluationCases.workspaceId, DEMO_WORKSPACE_ID)));
    const evaluations = await db.select({ id: evaluationRuns.id }).from(evaluationRuns).where(and(eq(evaluationRuns.agentId, context.agentId), eq(evaluationRuns.workspaceId, DEMO_WORKSPACE_ID)));
    const ownApprovals = runIds.length ? await db.select({ id: approvals.id }).from(approvals).where(inArray(approvals.runId, runIds)) : [];
    const ownOperations = runIds.length ? await db.select({ id: toolOperations.id }).from(toolOperations).where(inArray(toolOperations.sourceRunId, runIds)) : [];
    const auditTargetIds = [context.agentId, ...runIds, ...versions.map((row) => row.id), ...cases.map((row) => row.id), ...evaluations.map((row) => row.id), ...ownApprovals.map((row) => row.id), ...ownOperations.map((row) => row.id)];
    await db.delete(auditEvents).where(and(eq(auditEvents.workspaceId, DEMO_WORKSPACE_ID), inArray(auditEvents.targetId, auditTargetIds)));
    if (evaluations.length) await db.delete(evaluationCaseResults).where(and(eq(evaluationCaseResults.workspaceId, DEMO_WORKSPACE_ID), inArray(evaluationCaseResults.evaluationRunId, evaluations.map((row) => row.id))));
    if (runIds.length) {
      await db.delete(attentionCases).where(and(eq(attentionCases.workspaceId, DEMO_WORKSPACE_ID), inArray(attentionCases.runId, runIds)));
      await db.delete(runFeedback).where(and(eq(runFeedback.workspaceId, DEMO_WORKSPACE_ID), inArray(runFeedback.runId, runIds)));
      await db.delete(runDeliveries).where(and(eq(runDeliveries.workspaceId, DEMO_WORKSPACE_ID), inArray(runDeliveries.runId, runIds)));
      await db.delete(toolOperations).where(and(eq(toolOperations.workspaceId, DEMO_WORKSPACE_ID), inArray(toolOperations.sourceRunId, runIds)));
      await db.delete(approvals).where(and(eq(approvals.workspaceId, DEMO_WORKSPACE_ID), inArray(approvals.runId, runIds)));
      await db.delete(traceEvents).where(and(eq(traceEvents.workspaceId, DEMO_WORKSPACE_ID), inArray(traceEvents.runId, runIds)));
      await db.delete(modelCalls).where(and(eq(modelCalls.workspaceId, DEMO_WORKSPACE_ID), inArray(modelCalls.runId, runIds)));
      await db.delete(runSteps).where(and(eq(runSteps.workspaceId, DEMO_WORKSPACE_ID), inArray(runSteps.runId, runIds)));
      await db.delete(runs).where(and(eq(runs.workspaceId, DEMO_WORKSPACE_ID), inArray(runs.id, runIds)));
    }
    await db.delete(evaluationRuns).where(and(eq(evaluationRuns.workspaceId, DEMO_WORKSPACE_ID), eq(evaluationRuns.agentId, context.agentId)));
    await db.delete(evaluationCases).where(and(eq(evaluationCases.workspaceId, DEMO_WORKSPACE_ID), eq(evaluationCases.agentId, context.agentId)));
    await db.delete(agentVersions).where(and(eq(agentVersions.workspaceId, DEMO_WORKSPACE_ID), eq(agentVersions.agentId, context.agentId)));
    await db.delete(workflowDefinitions).where(and(eq(workflowDefinitions.workspaceId, DEMO_WORKSPACE_ID), eq(workflowDefinitions.agentId, context.agentId)));
    await db.delete(agents).where(owner);
  } finally {
    await context.tools.close();
    await context.model.close();
    vi.unstubAllEnvs();
  }
}
