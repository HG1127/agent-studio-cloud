import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { start } from "workflow/api";
import { ToolOperationReceipt } from "@/contracts/tool-operation";
import { agents, agentVersions, approvals, modelCalls, runs, runSteps, toolOperations, traceEvents } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { cancelRunAction } from "@/server/actions/cancel-run";
import { decideRunApprovalAction } from "@/server/actions/decide-run-approval";
import { resolveToolOperationAction } from "@/server/actions/resolve-tool-operation";
import { getRunTaskResult } from "@/server/queries/run-tasks";
import { agentRunWorkflow } from "@/server/workflows/agent-run";
import { createMvpAcceptanceFixture, startMvpAcceptanceTools } from "../helpers/mvp-acceptance-tools";
import { startModelJsonServer } from "../helpers/model-json-server";
import { waitForPendingApprovalHook } from "./approval-helpers";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
beforeAll(() => {
  expect(process.env.MVP_ACCEPTANCE_ISOLATED_DB, "仅 CI/CD 专用隔离库允许执行本套件").toBe("1");
});
let tools: Awaited<ReturnType<typeof startMvpAcceptanceTools>> | undefined;
let model: Awaited<ReturnType<typeof startModelJsonServer>> | undefined;
let fixture: ReturnType<typeof createMvpAcceptanceFixture>;
let versionId: string | undefined;
const runIds: string[] = [];
const workflows: Array<{ handle: Awaited<ReturnType<typeof start>>; done: boolean }> = [];

afterEach(async () => {
  for (const workflow of workflows) if (!workflow.done) await workflow.handle.cancel();
  workflows.length = 0;
  await tools?.close(); await model?.close(); tools = undefined; model = undefined;
  if (runIds.length) {
    await db.delete(toolOperations).where(inArray(toolOperations.sourceRunId, runIds));
    await db.delete(approvals).where(inArray(approvals.runId, runIds));
    await db.delete(traceEvents).where(inArray(traceEvents.runId, runIds));
    await db.delete(modelCalls).where(inArray(modelCalls.runId, runIds));
    await db.delete(runSteps).where(inArray(runSteps.runId, runIds));
    await db.delete(runs).where(inArray(runs.id, runIds));
  }
  runIds.length = 0;
  if (versionId) {
    await db.delete(agentVersions).where(eq(agentVersions.id, versionId));
    await db.delete(agents).where(eq(agents.id, fixture.agentId));
  }
  versionId = undefined; vi.unstubAllEnvs();
}, 60_000);

async function prepare(replies = ['{"customerId":"c1","amount":"wrong","approved":true}', '{"customerId":"c1","amount":0,"approved":true}']) {
  tools = await startMvpAcceptanceTools(); model = await startModelJsonServer(replies);
  fixture = createMvpAcceptanceFixture(tools);
  vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify(fixture.registry));
  vi.stubEnv("HARNESS_POLICY_JSON", ""); vi.stubEnv("HARNESS_MAX_PROMPT_CHARS", "");
  vi.stubEnv("MODEL_BASE_URL", model.baseUrl + "/v1"); vi.stubEnv("MODEL_API_KEY", "test-workflow-only-key");
  vi.stubEnv("MODEL_ID", "test-model"); vi.stubEnv("REAL_MODELS_ENABLED", "1");
  const owner = { workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID };
  await db.insert(agents).values({ ...owner, id: fixture.agentId, name: "链路验收助手", intentText: "读取、核对并登记客户方案" });
  const [version] = await db.insert(agentVersions).values({ ...owner, agentId: fixture.agentId, version: 1, status: "candidate", manifest: fixture.manifest }).returning({ id: agentVersions.id });
  versionId = version.id;
}
async function startRun(input: Record<string, unknown> = fixture.input) {
  const [row] = await db.insert(runs).values({ workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
    agentId: fixture.agentId, versionId: versionId!, status: "queued", input }).returning({ id: runs.id });
  runIds.push(row.id);
  const handle = await start(agentRunWorkflow, [row.id, fixture.manifest, input]);
  const tracked = { handle, done: false }; workflows.push(tracked);
  const settled = handle.returnValue.then(
    (value) => { tracked.done = true; return { ok: true as const, value }; },
    (error: unknown) => { tracked.done = true; return { ok: false as const, error }; },
  );
  await db.update(runs).set({ workflowRunId: handle.runId }).where(eq(runs.id, row.id));
  return { runId: row.id, handle, settled };
}
type StartedRun = Awaited<ReturnType<typeof startRun>>;
async function pendingApproval(run: StartedRun) {
  await waitForPendingApprovalHook(run.handle, run.runId);
  const [approval] = await db.select().from(approvals).where(eq(approvals.runId, run.runId)).limit(1);
  expect(approval?.status).toBe("pending");
  return approval;
}
async function approve(run: StartedRun) {
  const approval = await pendingApproval(run);
  expect(await decideRunApprovalAction({ runId: run.runId, approvalId: approval.id, decision: "approved", confirmed: true })).toMatchObject({ ok: true });
}
async function expectCompleted(run: StartedRun) {
  expect(await run.settled).toEqual({ ok: true, value: { status: "completed" } });
  const result = await getRunTaskResult(run.runId, DEMO_WORKSPACE_ID);
  expect(result).toMatchObject({ status: "completed", ready: true, error: null,
    result: { 交付: { 客户编号: "c1", 金额: 0, 已登记: true, 业务回执: "receipt-1" } } });
  return result;
}
async function expectFailed(run: StartedRun, reason: string) {
  const outcome = await run.settled;
  expect(outcome.ok).toBe(false);
  if (outcome.ok) throw new Error("预期运行失败");
  expect(String(outcome.error)).toContain(reason);
  await vi.waitFor(async () => {
    const result = await getRunTaskResult(run.runId, DEMO_WORKSPACE_ID);
    expect(result).toMatchObject({ status: "failed", ready: true, result: null });
  }, { timeout: 30_000, interval: 200 });
}
async function operationRows() {
  return db.select().from(toolOperations).where(inArray(toolOperations.sourceRunId, runIds));
}
async function expectNoBusinessProgress() {
  expect(tools!.writes).toHaveLength(0); expect(tools!.effectCount()).toBe(0);
  expect(await operationRows()).toHaveLength(0);
  expect(await db.select().from(approvals).where(inArray(approvals.runId, runIds))).toHaveLength(0);
}

describe("MVP 完整 MCP/模型/审批/业务账本链路（仅 CI 隔离库）", () => {
  it.each(["missing", "drift", 401, 403] as const)("读取失败 %s 永久停止完整链路", async (failure) => {
    await prepare();
    if (failure === "drift") tools!.controls.readDrift = true;
    else if (typeof failure === "number") tools!.controls.readStatus = failure;
    const input = failure === "missing" ? { requestId: fixture.input.requestId } : fixture.input;
    const run = await startRun(input);
    await expectFailed(run, failure === "missing" ? "缺少映射字段" : failure === "drift" ? "参数规则已变化" : "拒绝访问");
    expect(tools!.messages.filter((message) => message.method === "tools/call")).toHaveLength(typeof failure === "number" ? 1 : 0);
    expect(model!.modelRequests).toHaveLength(0); await expectNoBusinessProgress();
    const steps = await db.select().from(runSteps).where(eq(runSteps.runId, run.runId));
    expect(steps.find((step) => step.nodeId === "lookup")).toMatchObject({ status: "failed", attempt: 1 });
  });

  it("模型修正耗尽时不创建审批或业务账本，也不交付错误正文", async () => {
    await prepare(['{"customerId":"c1","amount":"test-only-never-log","approved":true}']);
    const run = await startRun(); await expectFailed(run, "模型结果未满足字段契约");
    expect(model!.modelRequests).toHaveLength(2); await expectNoBusinessProgress();
    const steps = await db.select().from(runSteps).where(eq(runSteps.runId, run.runId));
    const traces = await db.select().from(traceEvents).where(eq(traceEvents.runId, run.runId));
    expect(JSON.stringify({ steps, traces })).not.toContain("test-only-never-log");
  });

  it("真实审批 Hook 挂起时取消，迟到批准不能创建账本或发写请求", async () => {
    await prepare(); const run = await startRun(); const approval = await pendingApproval(run);
    expect(tools!.writes).toHaveLength(0); expect(await operationRows()).toHaveLength(0);
    expect(await cancelRunAction(run.runId)).toEqual({ ok: true });
    expect(await decideRunApprovalAction({ runId: run.runId, approvalId: approval.id, decision: "approved", confirmed: true })).toMatchObject({ ok: false });
    expect((await run.settled).ok).toBe(false);
    expect(await getRunTaskResult(run.runId, DEMO_WORKSPACE_ID)).toMatchObject({ status: "cancelled", ready: true, result: null });
    expect(tools!.writes).toHaveLength(0); expect(tools!.effectCount()).toBe(0); expect(await operationRows()).toHaveLength(0);
    const [cancelledApproval] = await db.select().from(approvals).where(eq(approvals.id, approval.id));
    expect(cancelledApproval).toMatchObject({ status: "rejected" });
  });

  it("人工拒绝带防重配置的写任务，不领取账本也不发送写请求", async () => {
    await prepare(); const run = await startRun(); const approval = await pendingApproval(run);
    expect(await decideRunApprovalAction({ runId: run.runId, approvalId: approval.id, decision: "rejected", confirmed: true })).toMatchObject({ ok: true });
    expect(await run.settled).toEqual({ ok: true, value: { status: "completed" } });
    expect(await getRunTaskResult(run.runId, DEMO_WORKSPACE_ID)).toMatchObject({ status: "completed", ready: true,
      result: { 处理状态: "未获确认" } });
    expect(tools!.writes).toHaveLength(0); expect(tools!.effectCount()).toBe(0); expect(await operationRows()).toHaveLength(0);
  });
  it("两次真实完整运行复用同一业务账本回执，审批前不领取或写入", async () => {
    await prepare(); const first = await startRun(); await pendingApproval(first);
    expect(await operationRows()).toHaveLength(0); expect(tools!.writes).toHaveLength(0);
    await approve(first); const firstResult = await expectCompleted(first);
    const [operation] = await operationRows(); expect(operation).toMatchObject({ status: "completed", receipt: { receiptId: "receipt-1" } });
    const second = await startRun({ ...fixture.input, private: "different-unselected-input" });
    await pendingApproval(second); expect(tools!.writes).toHaveLength(1); expect(await operationRows()).toHaveLength(1);
    await approve(second); const secondResult = await expectCompleted(second);
    expect(secondResult!.result).toEqual(firstResult!.result);
    expect(tools!.writes).toHaveLength(1); expect(tools!.effectCount()).toBe(1); expect(await operationRows()).toHaveLength(1);
    expect(tools!.writes[0].key).toMatch(/^studio-operation:v1:[a-f0-9]{64}$/);
    const traces = await db.select().from(traceEvents).where(eq(traceEvents.runId, second.runId));
    expect(traces.find((trace) => trace.kind === "tool.operation_reused")).toMatchObject({ data: { operationId: operation.id, reused: true, confirmedByHuman: false } });
    expect(JSON.stringify(model!.modelRequests)).not.toMatch(/must-not-send|different-unselected-input/);
    expect(await getRunTaskResult(second.runId, randomUUID())).toBeNull();
  });

  it("MCP 写入已生效但回执丢失，Workflow 有界重试账本键，副作用只有一次", async () => {
    await prepare(); tools!.controls.writeFault = "response-lost";
    const run = await startRun(); await approve(run); await expectCompleted(run);
    expect(tools!.writes).toHaveLength(2); expect(new Set(tools!.writes.map((write) => write.key)).size).toBe(1);
    expect(tools!.effectCount()).toBe(1);
    const [operation] = await operationRows(); expect(operation).toMatchObject({ status: "completed", receipt: { receiptId: "receipt-1" } });
    const steps = await db.select().from(runSteps).where(eq(runSteps.runId, run.runId));
    expect(steps.find((step) => step.nodeId === "record")).toMatchObject({ status: "succeeded", attempt: 2 });
  });

  it("写工具远端目录漂移后账本永久阻断，重新运行不会再次尝试写工具", async () => {
    await prepare(); tools!.controls.writeDrift = true;
    const first = await startRun(); await approve(first); await expectFailed(first, "参数规则已变化");
    const [operation] = await operationRows(); expect(operation).toMatchObject({ status: "blocked", receipt: null });
    const discoveries = tools!.messages.filter((message) => message.path === "/mcp-write").length;
    tools!.controls.writeDrift = false;
    const second = await startRun(); await approve(second); await expectFailed(second, "人工核对");
    expect(tools!.messages.filter((message) => message.path === "/mcp-write")).toHaveLength(discoveries);
    expect(tools!.writes).toHaveLength(0); expect(tools!.effectCount()).toBe(0);
  });

  it("过期未知操作必须人工核验，新完整运行复用实际回执且不延长截止或重发", async () => {
    await prepare(); tools!.controls.writeFault = "invalid-receipt";
    const first = await startRun(); await approve(first); await expectFailed(first, "回执不符合字段契约");
    const [operation] = await operationRows(); expect(operation).toMatchObject({ status: "blocked", receipt: null });
    // 模拟在外部成功但未确认回执的旧 pending 记录，截止日期已经过去。
    await db.update(toolOperations).set({ status: "pending", retryDeadline: new Date(0), leaseOwner: null, leaseExpiresAt: null }).where(eq(toolOperations.id, operation.id));
    tools!.controls.writeFault = "none";
    const second = await startRun(); await approve(second); await expectFailed(second, "人工核对");
    expect(tools!.writes).toHaveLength(1); expect(tools!.effectCount()).toBe(1);
    const retry = { operationId: operation.id, requestId: randomUUID(), kind: "retry" as const, confirmedNotExecuted: true as const, reason: "核对过期操作是否可以重新发送" };
    expect(await resolveToolOperationAction(retry)).toMatchObject({ ok: false, error: expect.stringContaining("有效期已过") });
    const receipt = tools!.receipt(tools!.writes[0].key); expect(receipt).toBeDefined();
    const resolution = { operationId: operation.id, requestId: randomUUID(), kind: "record-receipt" as const,
      confirmedCompleted: true as const, reason: "已到业务系统核对实际成功回执", receipt: ToolOperationReceipt.parse(receipt) };
    expect(await resolveToolOperationAction(resolution)).toEqual({ ok: true });
    expect(await resolveToolOperationAction(resolution)).toEqual({ ok: true });
    const third = await startRun(); await approve(third); await expectCompleted(third);
    const [confirmed] = await operationRows();
    expect(confirmed.retryDeadline.getTime()).toBe(0); expect(confirmed.resolutions).toHaveLength(1);
    expect(confirmed).toMatchObject({ status: "completed", receipt: { receiptId: "receipt-1" } });
    const traces = await db.select().from(traceEvents).where(eq(traceEvents.runId, third.runId));
    expect(traces.find((trace) => trace.kind === "tool.operation_reused")).toMatchObject({ data: { operationId: operation.id, reused: true, confirmedByHuman: true } });
    expect(tools!.writes).toHaveLength(1); expect(tools!.effectCount()).toBe(1);
    expect(JSON.stringify({ confirmed, traces })).not.toContain("test-only-never-log");
  });
});
