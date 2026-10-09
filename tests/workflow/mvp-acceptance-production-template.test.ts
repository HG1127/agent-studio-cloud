import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getRun } from "workflow/api";
import { ExecutionResourceSnapshot } from "@/contracts/execution-resources";
import { AgentManifest } from "@/contracts/manifest";
import { ApprovalPayload } from "@/contracts/run";
import { agents, agentVersions, approvals, auditEvents, evaluationCaseResults, evaluationCases, evaluationRuns, modelCalls, runs, runSteps, toolOperations, traceEvents } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { cancelRunAction } from "@/server/actions/cancel-run";
import { createMvpAgentAction } from "@/server/actions/create-mvp-agent";
import { decideRunApprovalAction } from "@/server/actions/decide-run-approval";
import { createEvaluationCaseAction, startEvaluationAction } from "@/server/actions/evaluations";
import { publishVersionAction } from "@/server/actions/publish-version";
import { startRunAction } from "@/server/actions/start-run";
import { getRunTaskResult } from "@/server/queries/run-tasks";
import { assertMvpAcceptanceIsolatedDb, cleanupMvpAcceptanceTemplate, prepareMvpAcceptanceTemplate, type MvpAcceptanceTemplateContext } from "../helpers/mvp-acceptance-template";
import { waitForPendingApprovalHook } from "./approval-helpers";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
beforeAll(assertMvpAcceptanceIsolatedDb);
let context: MvpAcceptanceTemplateContext | undefined;
let versionId: string;
afterEach(async () => {
  if (context) await cleanupMvpAcceptanceTemplate(context);
  context = undefined;
}, 60_000);

async function createAndPublish(replies?: string[], trialAmount?: number) {
  context = await prepareMvpAcceptanceTemplate(replies);
  expect(await createMvpAgentAction(context.spec, context.agentId)).toEqual({ ok: true, agentId: context.agentId });
  if (trialAmount !== undefined) {
    expect(await createEvaluationCaseAction({ agentId: context.agentId, name: "核对模板业务回执", input: context.input,
      expectations: [{ path: "amount", operator: "equals", value: trialAmount }, { path: "approved", operator: "equals", value: false }, { path: "receiptId", operator: "equals", value: "receipt-1" }] })).toEqual({ ok: true });
  }
  const published = await publishVersionAction(context.agentId);
  expect(published).toMatchObject({ ok: true, release: trialAmount === undefined ? "production" : "candidate" });
  if (!published.ok) throw new Error(`真实发布入口拒绝：${published.error}；${published.issues.join("；")}`);
  versionId = published.version.id;
  const [version] = await db.select().from(agentVersions).where(eq(agentVersions.id, versionId));
  const manifest = AgentManifest.parse(version.manifest);
  expect(manifest.resourceSelection.model.mock).toBe(false);
  expect(manifest.workflowSnapshot.nodes).toEqual(context.built.draft.nodes);
  expect(manifest.outputContract).toEqual(context.built.draft.outputContract);
  expect(context.tools.messages).toHaveLength(0);
  expect(context.model.modelRequests).toHaveLength(0);
}
async function ownRuns() {
  return db.select().from(runs).where(and(eq(runs.agentId, context!.agentId), eq(runs.workspaceId, DEMO_WORKSPACE_ID)));
}
async function ownOperations() {
  const rows = await ownRuns();
  return rows.length ? db.select().from(toolOperations).where(and(eq(toolOperations.workspaceId, DEMO_WORKSPACE_ID), inArray(toolOperations.sourceRunId, rows.map((row) => row.id)))) : [];
}
async function trackRun(runId: string) {
  const row = await vi.waitFor(async () => {
    const [run] = await db.select().from(runs).where(and(eq(runs.id, runId), eq(runs.agentId, context!.agentId), eq(runs.workspaceId, DEMO_WORKSPACE_ID)));
    expect(run?.workflowRunId).toBeTruthy();
    return run;
  }, { timeout: 30_000, interval: 200 });
  expect(row).toMatchObject({ agentId: context!.agentId, versionId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, executionRootRunId: runId });
  expect(ExecutionResourceSnapshot.parse(row.executionResources).version).toBe("v1");
  const handle = getRun(row.workflowRunId!);
  const settled = handle.returnValue.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
  return { runId, handle, settled, row };
}
async function startProductionRun(requestId = randomUUID()) {
  const started = await startRunAction({ agentId: context!.agentId, requestId, input: context!.input });
  expect(started).toMatchObject({ ok: true });
  if (!started.ok) throw new Error(`真实启动入口拒绝：${started.error}`);
  return { ...await trackRun(started.runId), requestId };
}
type TrackedRun = Awaited<ReturnType<typeof trackRun>>;
async function pendingApproval(run: TrackedRun) {
  await waitForPendingApprovalHook(run.handle, run.runId, "approve");
  const [approval] = await db.select().from(approvals).where(and(eq(approvals.runId, run.runId), eq(approvals.nodeId, "approve")));
  expect(approval).toMatchObject({ status: "pending", role: context!.spec.approvalRole, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID });
  const payload = ApprovalPayload.parse(approval.payload);
  expect(payload.review).toMatchObject({ sourceNodeId: "plan", format: "json" });
  expect(JSON.parse(payload.review!.content)).toEqual({ customerId: "c1", amount: 0, approved: false });
  expect(await getRunTaskResult(run.runId, DEMO_WORKSPACE_ID)).toMatchObject({ status: "waiting_approval", ready: false, result: null });
  return approval;
}
async function approve(run: TrackedRun) {
  const approval = await pendingApproval(run);
  expect(await decideRunApprovalAction({ runId: run.runId, approvalId: approval.id, confirmed: true, decision: "approved" })).toEqual({ ok: true });
}
async function completed(run: TrackedRun) {
  expect(await run.settled).toEqual({ ok: true, value: { status: "completed" } });
  const result = await getRunTaskResult(run.runId, DEMO_WORKSPACE_ID);
  expect(result).toMatchObject({ status: "completed", ready: true, error: null, result: { receiptId: "receipt-1", amount: 0, approved: false } });
  expect(result!.result).toEqual({ receiptId: "receipt-1", amount: 0, approved: false });
  expect(await getRunTaskResult(run.runId, randomUUID())).toBeNull();
  return result;
}
async function failed(run: TrackedRun, reason: string) {
  const outcome = await run.settled;
  expect(outcome.ok).toBe(false);
  if (outcome.ok) throw new Error("预期运行失败");
  expect(String(outcome.error)).toContain(reason);
  await vi.waitFor(async () => {
    expect(await getRunTaskResult(run.runId, DEMO_WORKSPACE_ID)).toMatchObject({ status: "failed", ready: true, result: null });
  }, { timeout: 30_000, interval: 200 });
}
function noWrites() {
  expect(context!.tools.writes).toHaveLength(0);
  expect(context!.tools.effectCount()).toBe(0);
}

describe("MVP 生产模板通过合法入口执行真实 SDK/审批/结果（仅 CI 临时隔离库）", () => {
  it.each(["missing-customer", "missing-request", "empty-customer", "wrong-type", "extra"] as const)("必填输入门禁 %s 在创建运行和连接 SDK 前拒绝", async (failure) => {
    await createAndPublish();
    const input: Record<string, unknown> = { ...context!.input };
    let reason = "不能为空";
    if (failure === "missing-customer") delete input.customerId;
    else if (failure === "missing-request") delete input.requestId;
    else if (failure === "empty-customer") input.customerId = "   ";
    else if (failure === "wrong-type") { input.customerId = 123; reason = "格式不正确"; }
    else { input.private = "undeclared-input-must-not-send"; reason = "未声明字段"; }
    expect(await startRunAction({ agentId: context!.agentId, input, requestId: randomUUID() })).toMatchObject({ ok: false, error: expect.stringContaining(reason) });
    expect(await ownRuns()).toHaveLength(0);
    expect(context!.tools.messages).toHaveLength(0);
    expect(context!.model.modelRequests).toHaveLength(0);
    noWrites();
  });

  it("工厂节点真实取数、模型修正、审批后写入、按回执 sourcePath 交付；启动请求与跨运行操作分别防重", async () => {
    await createAndPublish(['{"customerId":"c1","amount":"wrong","approved":false}', '{"customerId":"c1","amount":0,"approved":false}']);
    const first = await startProductionRun();
    await pendingApproval(first);
    expect(await ownOperations()).toHaveLength(0);
    noWrites();
    const reads = context!.tools.messages.filter((message) => message.path === "/mcp-read" && message.method === "tools/call");
    expect(reads).toHaveLength(1);
    expect(reads[0].params).toMatchObject({ name: "lookup_customer" });
    expect(reads[0].params?.arguments).toEqual({ customerId: "c1" });
    expect(context!.model.modelRequests).toHaveLength(2);
    expect(context!.model.modelRequests[0]).toMatchObject({ response_format: { type: "json_schema" }, messages: expect.arrayContaining([
      expect.objectContaining({ role: "user", content: expect.stringContaining(context!.input.requestId) }),
      expect.objectContaining({ role: "user", content: expect.stringContaining('"active": false') }),
    ]) });
    expect(await startRunAction({ agentId: context!.agentId, input: context!.input, requestId: first.requestId })).toEqual({ ok: true, runId: first.runId });
    expect(await ownRuns()).toHaveLength(1);
    await approve(first);
    const firstResult = await completed(first);
    expect(context!.tools.writes).toHaveLength(1);
    expect(context!.tools.writes[0].arguments).toEqual({ customerId: "c1", amount: 0, approved: false });
    expect(context!.tools.writes[0].key).toMatch(/^studio-operation:v1:[a-f0-9]{64}$/);
    const [operation] = await ownOperations();
    expect(operation).toMatchObject({ status: "completed", sourceRunId: first.runId, nodeTitle: context!.built.draft.nodes.execute.title, toolId: context!.spec.actionToolId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
      receipt: { receiptId: "receipt-1", customerId: "c1", amount: 0, approved: false } });
    const steps = await db.select().from(runSteps).where(eq(runSteps.runId, first.runId));
    expect(steps.find((step) => step.nodeId === "read")).toMatchObject({ status: "succeeded", output: { customerId: "c1", amount: 0, active: false } });
    expect(steps.find((step) => step.nodeId === "plan")).toMatchObject({ status: "succeeded", output: { output: { customerId: "c1", amount: 0, approved: false }, mock: false, repairCount: 1 } });
    expect(steps.find((step) => step.nodeId === "execute")).toMatchObject({ status: "succeeded", output: { receiptId: "receipt-1" } });
    expect(await db.select().from(modelCalls).where(eq(modelCalls.runId, first.runId))).toHaveLength(2);
    const second = await startProductionRun();
    expect(second.runId).not.toBe(first.runId);
    await pendingApproval(second);
    expect(context!.tools.writes).toHaveLength(1);
    expect(await ownOperations()).toHaveLength(1);
    await approve(second);
    expect((await completed(second))!.result).toEqual(firstResult!.result);
    expect(context!.tools.writes).toHaveLength(1);
    expect(context!.tools.effectCount()).toBe(1);
    expect(await ownOperations()).toHaveLength(1);
    expect(context!.model.modelRequests).toHaveLength(3);
    const traces = await db.select().from(traceEvents).where(eq(traceEvents.runId, second.runId));
    expect(traces.find((trace) => trace.kind === "tool.operation_reused")).toMatchObject({ data: { operationId: operation.id, reused: true } });
  });

  it("工厂审批被拒绝时停在真实拒绝分支，不领取账本或生成成功回执", async () => {
    await createAndPublish();
    const run = await startProductionRun();
    const approval = await pendingApproval(run);
    expect(await decideRunApprovalAction({ runId: run.runId, approvalId: approval.id, confirmed: true, decision: "rejected" })).toEqual({ ok: true });
    expect(await run.settled).toEqual({ ok: true, value: { status: "completed" } });
    expect(await getRunTaskResult(run.runId, DEMO_WORKSPACE_ID)).toMatchObject({ status: "completed", ready: true, result: { 处理状态: "未获确认" } });
    expect(await ownOperations()).toHaveLength(0);
    noWrites();
  });

  it("真实工厂审批 Hook 挂起时取消，迟到批准不能推动写操作", async () => {
    await createAndPublish();
    const run = await startProductionRun();
    const approval = await pendingApproval(run);
    expect(await cancelRunAction(run.runId)).toEqual({ ok: true });
    expect(await decideRunApprovalAction({ runId: run.runId, approvalId: approval.id, confirmed: true, decision: "approved" })).toMatchObject({ ok: false });
    expect((await run.settled).ok).toBe(false);
    expect(await getRunTaskResult(run.runId, DEMO_WORKSPACE_ID)).toMatchObject({ status: "cancelled", ready: true, result: null });
    expect(await ownOperations()).toHaveLength(0);
    noWrites();
  });

  it("工厂结构化模型修正耗尽时失败，不创建审批、账本或占位交付", async () => {
    await createAndPublish(['{"customerId":"c1","amount":"test-template-never-log","approved":false}']);
    const run = await startProductionRun();
    await failed(run, "模型结果未满足字段契约");
    expect(context!.model.modelRequests).toHaveLength(2);
    expect(await db.select().from(approvals).where(eq(approvals.runId, run.runId))).toHaveLength(0);
    expect(await ownOperations()).toHaveLength(0);
    noWrites();
    const steps = await db.select().from(runSteps).where(eq(runSteps.runId, run.runId));
    const traces = await db.select().from(traceEvents).where(eq(traceEvents.runId, run.runId));
    expect(JSON.stringify({ steps, traces })).not.toContain("test-template-never-log");
  });

  it("工厂取数节点远端字段漂移时真实 SDK 阻断，模型与审批没有进展", async () => {
    await createAndPublish();
    context!.tools.controls.readDrift = true;
    const run = await startProductionRun();
    await failed(run, "参数规则已变化");
    expect(context!.tools.messages.filter((message) => message.method === "tools/call")).toHaveLength(0);
    expect(context!.model.modelRequests).toHaveLength(0);
    expect(await db.select().from(approvals).where(eq(approvals.runId, run.runId))).toHaveLength(0);
    expect(await ownOperations()).toHaveLength(0);
    noWrites();
  });

  it("审批后的非法业务回执被真实 SDK 和账本阻断，结果查询不交付成功字段", async () => {
    await createAndPublish();
    context!.tools.controls.writeFault = "invalid-receipt";
    const run = await startProductionRun();
    await approve(run);
    await failed(run, "回执不符合字段契约");
    expect(context!.tools.writes).toHaveLength(1);
    expect(context!.tools.effectCount()).toBe(1);
    const [operation] = await ownOperations();
    expect(operation).toMatchObject({ status: "blocked", receipt: null });
  });

  it.each([true, false])("候选模板通过真实评测入口试跑，验收通过=%s 时由实际结果决定晋升", async (shouldPass) => {
    await createAndPublish(undefined, shouldPass ? 0 : 1);
    expect(await startRunAction({ agentId: context!.agentId, input: context!.input, requestId: randomUUID() })).toMatchObject({ ok: false, error: expect.stringContaining("没有发布版本") });
    expect(await ownRuns()).toHaveLength(0);
    const requestId = randomUUID();
    expect(await startEvaluationAction(context!.agentId, requestId)).toEqual({ ok: true });
    const [evaluation] = await db.select().from(evaluationRuns).where(and(eq(evaluationRuns.agentId, context!.agentId), eq(evaluationRuns.requestId, requestId)));
    const [caseRow] = await db.select().from(evaluationCases).where(eq(evaluationCases.agentId, context!.agentId));
    const [caseResult] = await db.select().from(evaluationCaseResults).where(eq(evaluationCaseResults.evaluationRunId, evaluation.id));
    expect(evaluation).toMatchObject({ versionId, status: "running", workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID });
    expect(caseResult).toMatchObject({ evaluationCaseId: caseRow.id, status: "running", caseSnapshot: { input: context!.input } });
    expect(caseResult.runId).toBeTruthy();
    const run = await trackRun(caseResult.runId!);
    expect(run.row).toMatchObject({ sourceType: "evaluation", sourceKey: `evaluation:${evaluation.id}:${caseRow.id}` });
    await pendingApproval(run);
    expect(await ownOperations()).toHaveLength(0);
    noWrites();
    expect(await startEvaluationAction(context!.agentId, requestId)).toEqual({ ok: true });
    expect(await ownRuns()).toHaveLength(1);
    await approve(run);
    await completed(run);
    await vi.waitFor(async () => {
      const [summary] = await db.select().from(evaluationRuns).where(eq(evaluationRuns.id, evaluation.id));
      expect(summary).toMatchObject({ status: "completed", totalCount: 1, passedCount: shouldPass ? 1 : 0, failedCount: shouldPass ? 0 : 1 });
    }, { timeout: 30_000, interval: 200 });
    const [finalCase] = await db.select().from(evaluationCaseResults).where(eq(evaluationCaseResults.id, caseResult.id));
    expect(finalCase.status).toBe(shouldPass ? "passed" : "failed");
    const [version] = await db.select().from(agentVersions).where(eq(agentVersions.id, versionId));
    expect(version.status).toBe(shouldPass ? "production" : "candidate");
    const promotions = await db.select().from(auditEvents).where(and(eq(auditEvents.targetId, versionId), eq(auditEvents.action, "version.promoted")));
    expect(promotions).toHaveLength(shouldPass ? 1 : 0);
    if (shouldPass) {
      const manual = await startProductionRun();
      await approve(manual);
      await completed(manual);
      expect(context!.tools.writes).toHaveLength(1);
      expect(context!.tools.effectCount()).toBe(1);
    } else {
      expect(await startRunAction({ agentId: context!.agentId, input: context!.input, requestId: randomUUID() })).toMatchObject({ ok: false });
      expect(await ownRuns()).toHaveLength(1);
    }
    expect(await db.select().from(agents).where(eq(agents.id, context!.agentId))).toHaveLength(1);
  });
});
