import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getRun } from "workflow/api";
import { ExecutionResourceSnapshot } from "@/contracts/execution-resources";
import { AgentManifest } from "@/contracts/manifest";
import { MvpTemplateBusinessSpec } from "@/contracts/mvp-template";
import { ApprovalPayload } from "@/contracts/run";
import { WorkflowDraft } from "@/contracts/workflow";
import { agents, agentVersions, approvals, auditEvents, modelCalls, runs, runSteps, toolOperations, workflowDefinitions } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { createMvpAgentAction } from "@/server/actions/create-mvp-agent";
import { decideRunApprovalAction } from "@/server/actions/decide-run-approval";
import { publishVersionAction } from "@/server/actions/publish-version";
import { startRunAction } from "@/server/actions/start-run";
import { auditWorkflow } from "@/server/domain/audit";
import { resolveNodeInput } from "@/server/domain/runtime/input-mapping";
import { getRunTaskResult } from "@/server/queries/run-tasks";
import { assertMvpAcceptanceIsolatedDb } from "../helpers/mvp-acceptance-template";
import { cleanupZeroArgumentReadTemplate, prepareZeroArgumentReadTemplate, type ZeroArgumentReadContext } from "../helpers/mvp-acceptance-zero-argument-read";
import { waitForPendingApprovalHook } from "./approval-helpers";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
beforeAll(assertMvpAcceptanceIsolatedDb);
let context: ZeroArgumentReadContext | undefined;
afterEach(async () => {
  try { if (context) await cleanupZeroArgumentReadTemplate(context); }
  finally { context = undefined; }
}, 60_000);

async function ownRuns() {
  return db.select().from(runs).where(and(eq(runs.agentId, context!.agentId), eq(runs.workspaceId, DEMO_WORKSPACE_ID)));
}

async function startOwnedRun(input: Record<string, unknown>) {
  const requestId = randomUUID();
  const pendingId = `request:${requestId}`;
  context!.pendingStartRunIds.add(pendingId);
  const started = await startRunAction({ agentId: context!.agentId, input, requestId });
  if (started.ok) {
    context!.pendingStartRunIds.delete(pendingId);
    context!.pendingStartRunIds.add(started.runId);
  }
  return { started, pendingId };
}

const cases: Array<{ name: string; schema: Record<string, unknown> }> = [
  { name: "明确空字段", schema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "省略字段定义", schema: { type: "object", additionalProperties: false } },
];

describe("零参数 MCP 读取经生产创建、发布、运行和审批交付（仅 CI 临时隔离库）", () => {
  it.each(cases)("$name：发送空参数且保留防重、审批和回执来源", async ({ schema }) => {
    context = await prepareZeroArgumentReadTemplate(schema);
    const factoryRead = context.built.draft.nodes.read;
    expect(factoryRead.inputMapping).toEqual({ fields: [], includeUpstreamOutputs: false });
    expect(factoryRead.tool?.inputSchema).toEqual(schema);
    expect(MvpTemplateBusinessSpec.parse(factoryRead.businessSpec).inputs).toEqual([]);
    expect(factoryRead.businessSpec).toMatchObject({ evidence: [context.spec.businessGoal, context.spec.businessRules], grounding: { status: "grounded", score: 1 } });
    // 真实起点不产生上游产出；非空上游隔离仅用生产纯函数探针验证。
    const probeOutputs = { earlier: { private: "probe-only-upstream-must-not-send" } };
    expect(resolveNodeInput({ node: factoryRead, input: context.input, outputs: probeOutputs })).toEqual({ ok: true, input: {}, outputs: {} });
    expect(probeOutputs).toEqual({ earlier: { private: "probe-only-upstream-must-not-send" } });

    expect(await createMvpAgentAction(context.spec, context.agentId)).toEqual({ ok: true, agentId: context.agentId });
    const [agent] = await db.select().from(agents).where(and(eq(agents.id, context.agentId), eq(agents.workspaceId, DEMO_WORKSPACE_ID)));
    const definitions = await db.select().from(workflowDefinitions).where(and(eq(workflowDefinitions.agentId, context.agentId), eq(workflowDefinitions.workspaceId, DEMO_WORKSPACE_ID)));
    expect(agent).toMatchObject({ id: context.agentId, createdBy: DEMO_USER_ID, status: "draft", intentText: context.built.intentText });
    expect(definitions).toHaveLength(1);
    expect(definitions[0].createdBy).toBe(DEMO_USER_ID);
    const draft = WorkflowDraft.parse(definitions[0].draft);
    expect(draft.rootAgent).toMatchObject({ id: context.agentId, name: context.spec.name });
    expect(draft.nodes).toEqual(context.built.draft.nodes);
    expect(MvpTemplateBusinessSpec.parse(draft.nodes.read.businessSpec).inputs).toEqual([]);

    const published = await publishVersionAction(context.agentId);
    expect(published).toMatchObject({ ok: true, release: "production" });
    if (!published.ok) throw new Error(`零参数真实发布拒绝：${published.error}；${published.issues.join("；")}`);
    expect(await publishVersionAction(context.agentId)).toEqual(published);
    const publishedAudits = await db.select().from(auditEvents).where(and(eq(auditEvents.targetId, published.version.id), eq(auditEvents.workspaceId, DEMO_WORKSPACE_ID), eq(auditEvents.action, "version.published")));
    expect(publishedAudits).toHaveLength(1);
    expect(publishedAudits[0]).toMatchObject({ createdBy: DEMO_USER_ID, data: { release: "production" } });
    const versions = await db.select().from(agentVersions).where(and(eq(agentVersions.agentId, context.agentId), eq(agentVersions.workspaceId, DEMO_WORKSPACE_ID)));
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ id: published.version.id, createdBy: DEMO_USER_ID, status: "production" });
    const manifest = AgentManifest.parse(versions[0].manifest);
    expect(manifest.workflowSnapshot).toEqual(draft);
    expect(manifest.workflowSnapshot.nodes.read.tool?.inputSchema).toEqual(schema);
    expect(MvpTemplateBusinessSpec.parse(manifest.workflowSnapshot.nodes.read.businessSpec).inputs).toEqual([]);
    expect(manifest.resourceSelection.model).toEqual({ modelId: "test-model", mock: false, connectionId: null });
    expect(manifest.inputContract.fields).toEqual(context.spec.inputs.map((field) => ({ ...field, required: true })));
    expect(manifest.inputContract.fields.find((field) => field.name === "requestId")).toMatchObject({ type: "string", required: true });
    expect(manifest.workflowSnapshot.nodes.execute.toolOperation).toEqual({ scope: context.spec.actionToolId, key: { kind: "input", path: ["requestId"] } });
    expect(manifest.workflowSnapshot.nodes.approve).toMatchObject({ type: "human", next: "execute", rejectNext: "end", approval: { role: context.spec.approvalRole } });
    expect(manifest.outputContract).toEqual(context.built.draft.outputContract);
    expect(manifest.outputContract?.fields).toEqual(context.spec.deliverables.map(({ field, label }) => ({ path: field, label, required: true, sourceNodeId: "execute", sourcePath: [field] })));
    const audit = auditWorkflow(draft);
    expect(manifest.designAudit).toMatchObject({ issueCount: audit.issues.length, criticalCount: audit.counts.critical });
    expect(manifest.designAudit.status).not.toBe("blocked");
    expect(context.read.messages).toHaveLength(0);
    expect(context.tools.messages).toHaveLength(0);
    expect(context.model.modelRequests).toHaveLength(0);

    const rejected = await startOwnedRun({ customerId: context.input.customerId });
    expect(rejected.started)
      .toMatchObject({ ok: false, error: expect.stringContaining("不能为空") });
    expect(await ownRuns()).toHaveLength(0);
    expect(context.read.messages).toHaveLength(0);
    expect(context.tools.messages).toHaveLength(0);
    expect(context.model.modelRequests).toHaveLength(0);

    context.pendingStartRunIds.delete(rejected.pendingId);
    const { started } = await startOwnedRun(context.input);
    expect(started).toMatchObject({ ok: true });
    if (!started.ok) throw new Error(`零参数真实运行拒绝：${started.error}`);
    const row = await vi.waitFor(async () => {
      const [run] = await db.select().from(runs).where(and(eq(runs.id, started.runId), eq(runs.agentId, context!.agentId), eq(runs.workspaceId, DEMO_WORKSPACE_ID)));
      expect(run?.workflowRunId).toBeTruthy();
      return run;
    }, { timeout: 30_000, interval: 200 });
    const handle = getRun(row.workflowRunId!);
    context.workflowHandles.push(handle);
    context.pendingStartRunIds.delete(started.runId);
    expect(row).toMatchObject({ versionId: published.version.id, input: context.input, createdBy: DEMO_USER_ID, sourceType: "manual", executionRootRunId: started.runId });
    expect(ExecutionResourceSnapshot.parse(row.executionResources).version).toBe("v1");
    const settled = handle.returnValue.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
    await waitForPendingApprovalHook(handle, started.runId, "approve");
    const [approval] = await db.select().from(approvals).where(and(eq(approvals.runId, started.runId), eq(approvals.nodeId, "approve"), eq(approvals.workspaceId, DEMO_WORKSPACE_ID)));
    expect(approval).toMatchObject({ status: "pending", role: context.spec.approvalRole, createdBy: DEMO_USER_ID });
    const payload = ApprovalPayload.parse(approval.payload);
    expect(payload.review).toMatchObject({ sourceNodeId: "plan", format: "json" });
    expect(JSON.parse(payload.review!.content)).toEqual({ customerId: "c1", amount: 0, approved: false });
    expect(await getRunTaskResult(started.runId, DEMO_WORKSPACE_ID)).toMatchObject({ status: "waiting_approval", ready: false, result: null });

    const calls = context.read.messages.filter((message) => message.method === "tools/call");
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toEqual({ name: "lookup_customer", arguments: {} });
    const outboundRead = JSON.stringify(context.read.messages);
    expect(outboundRead).not.toContain(context.input.requestId);
    expect(outboundRead).not.toContain('"customerId"');
    expect(outboundRead).not.toContain('"outputs"');
    expect(outboundRead).not.toContain("probe-only-upstream-must-not-send");
    expect(context.tools.messages.filter((message) => message.path === "/mcp-read")).toHaveLength(0);
    expect(context.model.modelRequests).toHaveLength(1);
    expect(context.model.modelRequests[0]).toMatchObject({ response_format: { type: "json_schema" }, messages: expect.arrayContaining([
      expect.objectContaining({ role: "user", content: expect.stringContaining(context.input.requestId) }),
      expect.objectContaining({ role: "user", content: expect.stringContaining('"active": false') }),
    ]) });
    expect(await db.select().from(modelCalls).where(and(eq(modelCalls.runId, started.runId), eq(modelCalls.workspaceId, DEMO_WORKSPACE_ID)))).toHaveLength(1);
    expect(await db.select().from(toolOperations).where(and(eq(toolOperations.sourceRunId, started.runId), eq(toolOperations.workspaceId, DEMO_WORKSPACE_ID)))).toHaveLength(0);
    expect(context.tools.writes).toHaveLength(0);
    expect(context.tools.effectCount()).toBe(0);

    expect(await decideRunApprovalAction({ runId: started.runId, approvalId: approval.id, confirmed: true, decision: "approved" })).toEqual({ ok: true });
    expect(await settled).toEqual({ ok: true, value: { status: "completed" } });
    expect(await getRunTaskResult(started.runId, DEMO_WORKSPACE_ID)).toMatchObject({ status: "completed", ready: true, error: null, result: { receiptId: "receipt-1", amount: 0, approved: false } });
    expect((await getRunTaskResult(started.runId, DEMO_WORKSPACE_ID))?.result).toEqual({ receiptId: "receipt-1", amount: 0, approved: false });
    expect(await getRunTaskResult(started.runId, randomUUID())).toBeNull();
    expect(context.tools.writes).toHaveLength(1);
    expect(context.tools.effectCount()).toBe(1);
    expect(context.tools.writes[0].arguments).toEqual({ customerId: "c1", amount: 0, approved: false });
    const operations = await db.select().from(toolOperations).where(and(eq(toolOperations.sourceRunId, started.runId), eq(toolOperations.workspaceId, DEMO_WORKSPACE_ID)));
    expect(operations).toHaveLength(1);
    const operation = operations[0];
    expect(context.tools.writes[0].key).toBe(`studio-operation:v1:${operation.keyHash}`);
    const receipt = context.tools.receipt(context.tools.writes[0].key);
    expect(receipt).toEqual({ ok: true, receiptId: "receipt-1", customerId: "c1", amount: 0, approved: false });
    expect(operation).toMatchObject({ status: "completed", sourceRunId: started.runId, toolId: context.spec.actionToolId, createdBy: DEMO_USER_ID, receipt });
    const steps = await db.select().from(runSteps).where(and(eq(runSteps.runId, started.runId), eq(runSteps.workspaceId, DEMO_WORKSPACE_ID)));
    expect(steps.find((step) => step.nodeId === "read")).toMatchObject({ status: "succeeded", output: context.read.facts });
    expect(steps.find((step) => step.nodeId === "plan")).toMatchObject({ status: "succeeded", output: { output: { customerId: "c1", amount: 0, approved: false }, mock: false, repairCount: 0 } });
    expect(steps.find((step) => step.nodeId === "execute")).toMatchObject({ status: "succeeded", output: receipt });
    expect(context.read.messages.filter((message) => message.method === "tools/call")).toHaveLength(1);
    expect(JSON.stringify(context.read.messages)).not.toContain(context.input.requestId);
    expect(await ownRuns()).toHaveLength(1);
  });
});
