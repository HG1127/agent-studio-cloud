import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getRun } from "workflow/api";
import { AgentManifest } from "@/contracts/manifest";
import { ApprovalPayload } from "@/contracts/run";
import { ToolOperationReceipt } from "@/contracts/tool-operation";
import { agentVersions, approvals, runs, runSteps, toolOperations, traceEvents } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { createMvpAgentAction } from "@/server/actions/create-mvp-agent";
import { decideRunApprovalAction } from "@/server/actions/decide-run-approval";
import { publishVersionAction } from "@/server/actions/publish-version";
import { resolveToolOperationAction } from "@/server/actions/resolve-tool-operation";
import { startRunAction } from "@/server/actions/start-run";
import { resolveToolRetryPolicy } from "@/server/domain/runtime/retry-policy";
import { getRunTaskResult } from "@/server/queries/run-tasks";
import { assertMvpAcceptanceIsolatedDb, cleanupMvpAcceptanceTemplate, prepareMvpAcceptanceTemplate, type MvpAcceptanceTemplateContext } from "../helpers/mvp-acceptance-template";
import { waitForPendingApprovalHook } from "./approval-helpers";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
beforeAll(assertMvpAcceptanceIsolatedDb);
let context: MvpAcceptanceTemplateContext | undefined;
let manifest: AgentManifest;
let versionId: string;
afterEach(async () => {
  if (context) await cleanupMvpAcceptanceTemplate(context);
  context = undefined;
}, 60_000);

async function createAndPublish(replies?: string[]) {
  context = await prepareMvpAcceptanceTemplate(replies);
  expect(await createMvpAgentAction(context.spec, context.agentId)).toEqual({ ok: true, agentId: context.agentId });
  const published = await publishVersionAction(context.agentId);
  expect(published).toMatchObject({ ok: true, release: "production" });
  if (!published.ok) throw new Error(`真实发布拒绝：${published.error}；${published.issues.join("；")}`);
  versionId = published.version.id;
  const [version] = await db.select().from(agentVersions).where(eq(agentVersions.id, versionId));
  manifest = AgentManifest.parse(version.manifest);
  expect(manifest.workflowSnapshot.nodes).toEqual(context.built.draft.nodes);
  expect(manifest.resourceSelection.model).toEqual({ modelId: "test-model", mock: false, connectionId: null });
  const execute = manifest.workflowSnapshot.nodes.execute;
  expect(execute.retry).toBeUndefined();
  expect(execute.tool?.maxRetries).toBe(3);
  expect(resolveToolRetryPolicy(execute)).toEqual({ maxAttempts: 3, backoffMs: 5_000 });
  expect(execute.toolOperation).toEqual({ scope: context.spec.actionToolId, key: { kind: "input", path: ["requestId"] } });
  expect(context.tools.messages).toHaveLength(0);
  expect(context.model.modelRequests).toHaveLength(0);
}
async function startTemplateRun(input: Record<string, unknown> = context!.input) {
  const started = await startRunAction({ agentId: context!.agentId, requestId: randomUUID(), input });
  expect(started).toMatchObject({ ok: true });
  if (!started.ok) throw new Error(`真实启动拒绝：${started.error}`);
  const row = await vi.waitFor(async () => {
    const [run] = await db.select().from(runs).where(and(eq(runs.id, started.runId), eq(runs.agentId, context!.agentId), eq(runs.workspaceId, DEMO_WORKSPACE_ID)));
    expect(run?.workflowRunId).toBeTruthy();
    return run;
  }, { timeout: 30_000, interval: 200 });
  expect(row).toMatchObject({ versionId, input, createdBy: DEMO_USER_ID, sourceType: "manual", executionRootRunId: started.runId });
  const handle = getRun(row.workflowRunId!);
  const settled = handle.returnValue.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
  return { runId: row.id, handle, settled };
}
type TemplateRun = Awaited<ReturnType<typeof startTemplateRun>>;
async function operationRows() {
  const owned = await db.select({ id: runs.id }).from(runs).where(and(eq(runs.agentId, context!.agentId), eq(runs.workspaceId, DEMO_WORKSPACE_ID)));
  return owned.length ? db.select().from(toolOperations).where(and(eq(toolOperations.workspaceId, DEMO_WORKSPACE_ID), inArray(toolOperations.sourceRunId, owned.map((run) => run.id)))) : [];
}
async function onlyOperation() {
  const rows = await operationRows();
  expect(rows).toHaveLength(1);
  return rows[0];
}
async function pending(run: TemplateRun, customerId = "c1") {
  await waitForPendingApprovalHook(run.handle, run.runId, "approve");
  const [approval] = await db.select().from(approvals).where(and(eq(approvals.runId, run.runId), eq(approvals.nodeId, "approve")));
  expect(approval).toMatchObject({ status: "pending", workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID });
  const payload = ApprovalPayload.parse(approval.payload);
  expect(payload.review).toMatchObject({ sourceNodeId: "plan", format: "json" });
  expect(JSON.parse(payload.review!.content)).toEqual({ customerId, amount: 0, approved: false });
  expect(await getRunTaskResult(run.runId, DEMO_WORKSPACE_ID)).toMatchObject({ ready: false, result: null });
  return approval;
}
async function approve(run: TemplateRun, customerId = "c1") {
  const approval = await pending(run, customerId);
  expect(await decideRunApprovalAction({ runId: run.runId, approvalId: approval.id, decision: "approved", confirmed: true })).toEqual({ ok: true });
}
async function completed(run: TemplateRun) {
  expect(await run.settled).toEqual({ ok: true, value: { status: "completed" } });
  const result = await getRunTaskResult(run.runId, DEMO_WORKSPACE_ID);
  expect(result).toMatchObject({ status: "completed", ready: true, result: { receiptId: "receipt-1", amount: 0, approved: false } });
  expect(result!.result).toEqual({ receiptId: "receipt-1", amount: 0, approved: false });
  return result;
}
async function failed(run: TemplateRun, reason: string) {
  const outcome = await run.settled;
  expect(outcome.ok).toBe(false);
  if (outcome.ok) throw new Error("预期失败");
  expect(String(outcome.error)).toContain(reason);
  await vi.waitFor(async () => {
    expect(await getRunTaskResult(run.runId, DEMO_WORKSPACE_ID)).toMatchObject({ status: "failed", ready: true, result: null });
  }, { timeout: 30_000, interval: 200 });
}
async function executeStep(run: TemplateRun) {
  const [step] = await db.select().from(runSteps).where(and(eq(runSteps.runId, run.runId), eq(runSteps.nodeId, "execute")));
  return step;
}
function actualReceipt() {
  const receipt = context!.tools.receipt(context!.tools.writes[0].key);
  expect(receipt).toBeDefined();
  return ToolOperationReceipt.parse(receipt);
}
async function recordActualReceipt(operationId: string) {
  const resolution = { operationId, requestId: randomUUID(), kind: "record-receipt" as const, confirmedCompleted: true as const,
    reason: "已在假业务系统核对一次实际写入及对应回执", receipt: actualReceipt() };
  expect(await resolveToolOperationAction(resolution)).toEqual({ ok: true });
  expect(await resolveToolOperationAction(resolution)).toEqual({ ok: true });
  return resolution;
}
function expectSameKeyAndEffect(writes: number, keyHash: string) {
  expect(context!.tools.writes).toHaveLength(writes);
  expect(context!.tools.writes.every((write) => write.key === `studio-operation:v1:${keyHash}`)).toBe(true);
  expect(context!.tools.writes.map((write) => write.arguments)).toEqual(Array.from({ length: writes }, () => ({ customerId: "c1", amount: 0, approved: false })));
  expect(context!.tools.effectCount()).toBe(1);
}
async function expectHumanReuse(run: TemplateRun, operationId: string) {
  const traces = await db.select().from(traceEvents).where(eq(traceEvents.runId, run.runId));
  expect(traces.find((trace) => trace.kind === "tool.operation_reused")).toMatchObject({ data: { operationId, reused: true, confirmedByHuman: true } });
}

describe("MVP 生产模板的失败恢复与业务冲突（仅 CI 临时隔离库）", () => {
  it("工厂默认策略下写入已生效但503丢回执，第二次使用同一账本键且副作用一次", async () => {
    await createAndPublish();
    context!.tools.controls.writeFault = "response-lost";
    const run = await startTemplateRun();
    await pending(run);
    expect(await operationRows()).toHaveLength(0);
    expect(context!.tools.writes).toHaveLength(0);
    await approve(run);
    await completed(run);
    const operation = await onlyOperation();
    expect(operation).toMatchObject({ status: "completed", receipt: actualReceipt(), resolutions: [] });
    expectSameKeyAndEffect(2, operation.keyHash);
    expect(await executeStep(run)).toMatchObject({ status: "succeeded", attempt: 2 });
    expect(context!.model.modelRequests).toHaveLength(1);
  });

  it("非法回执真实阻断后仍拒绝新任务自动重发，人工录入实际回执后新启动复用且不延长期限", async () => {
    await createAndPublish();
    context!.tools.controls.writeFault = "invalid-receipt";
    const first = await startTemplateRun();
    await approve(first);
    await failed(first, "回执不符合字段契约");
    const blocked = await onlyOperation();
    expect(blocked).toMatchObject({ status: "blocked", receipt: null, resolutions: [] });
    expectSameKeyAndEffect(1, blocked.keyHash);
    expect(await executeStep(first)).toMatchObject({ status: "failed", attempt: 1 });
    context!.tools.controls.writeFault = "none";
    const discoveries = context!.tools.messages.filter((message) => message.path === "/mcp-write").length;
    const second = await startTemplateRun();
    await approve(second);
    await failed(second, "人工核对");
    expect(await onlyOperation()).toEqual(blocked);
    expect(context!.tools.messages.filter((message) => message.path === "/mcp-write")).toHaveLength(discoveries);
    const resolution = await recordActualReceipt(blocked.id);
    const confirmed = await onlyOperation();
    expect(confirmed).toMatchObject({ status: "completed", receipt: resolution.receipt, resolutions: [{ requestId: resolution.requestId, kind: "record-receipt" }] });
    expect(confirmed.retryDeadline.getTime()).toBe(blocked.retryDeadline.getTime());
    const third = await startTemplateRun();
    await pending(third);
    expectSameKeyAndEffect(1, blocked.keyHash);
    await approve(third);
    await completed(third);
    expect((await onlyOperation()).retryDeadline.getTime()).toBe(blocked.retryDeadline.getTime());
    expect((await onlyOperation()).resolutions).toHaveLength(1);
    await expectHumanReuse(third, blocked.id);
    expectSameKeyAndEffect(1, blocked.keyHash);
    expect(await getRunTaskResult(first.runId, DEMO_WORKSPACE_ID)).toMatchObject({ status: "failed", result: null });
    expect(await getRunTaskResult(second.runId, DEMO_WORKSPACE_ID)).toMatchObject({ status: "failed", result: null });
  });

  it("工厂三次503上限后未知操作过期，新启动和人工重试均不能重发，实际回执可核验恢复", async () => {
    await createAndPublish();
    context!.tools.controls.writeFault = "response-lost-always";
    const first = await startTemplateRun();
    await approve(first);
    await failed(first, "暂时无法连接");
    const unknown = await onlyOperation();
    expect(unknown).toMatchObject({ status: "pending", receipt: null, leaseOwner: null, leaseExpiresAt: null });
    expectSameKeyAndEffect(3, unknown.keyHash);
    expect(await executeStep(first)).toMatchObject({ status: "failed", attempt: resolveToolRetryPolicy(manifest.workflowSnapshot.nodes.execute).maxAttempts });
    assertMvpAcceptanceIsolatedDb();
    // 仅本套件实际未知账本的截止时间模拟过期，不等待一天，也不改状态或引擎时钟。
    const expired = await db.update(toolOperations).set({ retryDeadline: new Date(0) }).where(and(
      eq(toolOperations.id, unknown.id), eq(toolOperations.sourceRunId, first.runId), eq(toolOperations.workspaceId, DEMO_WORKSPACE_ID),
    )).returning({ id: toolOperations.id });
    expect(expired).toEqual([{ id: unknown.id }]);
    context!.tools.controls.writeFault = "none";
    const discoveries = context!.tools.messages.filter((message) => message.path === "/mcp-write").length;
    const second = await startTemplateRun();
    await approve(second);
    await failed(second, "人工核对");
    const blocked = await onlyOperation();
    expect(blocked).toMatchObject({ status: "blocked", receipt: null, retryDeadline: new Date(0), resolutions: [] });
    expect(context!.tools.messages.filter((message) => message.path === "/mcp-write")).toHaveLength(discoveries);
    // 即使提交错误的“尚未执行”声明，过期门禁也必须拒绝，不保存虚假核对历史。
    expect(await resolveToolOperationAction({ operationId: blocked.id, requestId: randomUUID(), kind: "retry", confirmedNotExecuted: true,
      reason: "用于验证过期门禁不允许重新发送操作" })).toMatchObject({ ok: false, error: expect.stringContaining("有效期已过") });
    expect(await onlyOperation()).toEqual(blocked);
    const resolution = await recordActualReceipt(blocked.id);
    expect((await onlyOperation()).retryDeadline.getTime()).toBe(0);
    expect((await onlyOperation()).receipt).toEqual(resolution.receipt);
    const third = await startTemplateRun();
    await approve(third);
    await completed(third);
    const recovered = await onlyOperation();
    expect(recovered).toMatchObject({ status: "completed", retryDeadline: new Date(0) });
    expect(recovered.resolutions).toHaveLength(1);
    await expectHumanReuse(third, blocked.id);
    expectSameKeyAndEffect(3, unknown.keyHash);
    expect(context!.tools.messages.filter((message) => message.path === "/mcp-write")).toHaveLength(discoveries);
  });

  it("同一业务编号对应不同合法客户方案时拒绝复用旧结果、二次写入或覆盖原账本", async () => {
    await createAndPublish(['{"customerId":"c1","amount":0,"approved":false}', '{"customerId":"c2","amount":0,"approved":false}']);
    const first = await startTemplateRun();
    await approve(first);
    const firstResult = await completed(first);
    const original = await onlyOperation();
    expect(original).toMatchObject({ status: "completed", receipt: { customerId: "c1" } });
    const changedInput = { ...context!.input, customerId: "c2" };
    const second = await startTemplateRun(changedInput);
    const approval = await pending(second, "c2");
    expect(await onlyOperation()).toEqual(original);
    expectSameKeyAndEffect(1, original.keyHash);
    const discoveries = context!.tools.messages.filter((message) => message.path === "/mcp-write").length;
    expect(await decideRunApprovalAction({ runId: second.runId, approvalId: approval.id, decision: "approved", confirmed: true })).toEqual({ ok: true });
    await failed(second, "请求内容已变化");
    expect(await onlyOperation()).toEqual(original);
    expectSameKeyAndEffect(1, original.keyHash);
    expect(context!.tools.messages.filter((message) => message.path === "/mcp-write")).toHaveLength(discoveries);
    const steps = await db.select().from(runSteps).where(eq(runSteps.runId, second.runId));
    expect(steps.find((step) => step.nodeId === "plan")).toMatchObject({ status: "succeeded", output: { output: { customerId: "c2", amount: 0, approved: false } } });
    expect(await executeStep(second)).toMatchObject({ status: "failed", attempt: 1, output: null });
    expect((await getRunTaskResult(first.runId, DEMO_WORKSPACE_ID))!.result).toEqual(firstResult!.result);
    const traces = await db.select().from(traceEvents).where(eq(traceEvents.runId, second.runId));
    expect(traces.some((trace) => trace.kind === "tool.operation_reused")).toBe(false);
    expect(context!.model.modelRequests).toHaveLength(2);
  });
});
