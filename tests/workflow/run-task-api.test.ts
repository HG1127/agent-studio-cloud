import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getRun } from "workflow/api";
import { POST } from "@/app/api/runs/route";
import { GET as getStatus } from "@/app/api/runs/[runId]/route";
import { GET as getResult } from "@/app/api/runs/[runId]/result/route";
import { POST as cancelTask } from "@/app/api/runs/[runId]/cancel/route";
import { GET as readApproval, POST as decideTaskApproval } from "@/app/api/runs/[runId]/approvals/[approvalId]/route";
import { GET as readApprovals } from "@/app/api/runs/[runId]/approvals/route";
import { RunApprovalGetResult, RunApprovalListResult } from "@/contracts/run-approval";
import { AgentManifest } from "@/contracts/manifest";
import { RunTaskResult, RunTaskStartResult, RunTaskStatusResult } from "@/contracts/run-task";
import { ApprovalPayload } from "@/contracts/run";
import { agents, agentVersions, approvals, runs, runSteps, traceEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { decideApprovalAction } from "@/server/actions/decide-approval";
import { resolvePath, runEvalContext } from "@/server/domain/runtime/condition-eval";
import { projectWorkflowResult } from "@/server/domain/runtime/output-contract";
import { waitForPendingApprovalHook } from "./approval-helpers";
import { startModelJsonServer } from "../helpers/model-json-server";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

let agentId: string | undefined;
let versionId: string | undefined;
let runId: string | undefined;
let handle: ReturnType<typeof getRun> | undefined;
let service: Awaited<ReturnType<typeof startModelJsonServer>> | undefined;
const ORIGIN = "http://localhost";
const schema = { type: "object", required: ["amount", "approved"], additionalProperties: false,
  properties: { amount: { type: "number" }, approved: { type: "boolean" } } };
const outputContract = { fields: [{ path: "extract.amount", label: "金额", required: true }, { path: "extract.approved", label: "已确认", required: true }] };

afterEach(async () => {
  if (runId) {
    const [run] = await db.select({ status: runs.status }).from(runs).where(eq(runs.id, runId));
    if (handle && run && !["completed", "failed", "cancelled"].includes(run.status)) await handle.cancel();
    await db.delete(approvals).where(eq(approvals.runId, runId));
    await db.delete(traceEvents).where(eq(traceEvents.runId, runId));
    await db.delete(runSteps).where(eq(runSteps.runId, runId));
  }
  if (agentId) await db.delete(runs).where(eq(runs.agentId, agentId));
  if (versionId) await db.delete(agentVersions).where(eq(agentVersions.id, versionId));
  if (agentId) await db.delete(agents).where(eq(agents.id, agentId));
  await service?.close();
  service = undefined;
  agentId = versionId = runId = undefined;
  handle = undefined;
  vi.unstubAllEnvs();
});
async function prepare(needsApproval = false, invalidReply = false, replies?: string[]) {
  agentId = randomUUID();
  versionId = randomUUID();
  service = await startModelJsonServer(replies ?? [invalidReply ? '{"amount":"sk-private-invalid-123456","approved":false}' : '{"amount":0,"approved":false}']);
  vi.stubEnv("MODEL_BASE_URL", service.baseUrl + "/v1");
  vi.stubEnv("MODEL_API_KEY", "test-task-workflow-only-key");
  vi.stubEnv("MODEL_ID", "test-model");
  vi.stubEnv("REAL_MODELS_ENABLED", "1");
  const manifest = AgentManifest.parse({
    schemaVersion: "4.0", workflowFingerprint: "run-task-sdk-test", outputContract,
    inputContract: { fields: [{ name: "brief", type: "string", required: true }] },
    resourceSelection: { model: { modelId: "test-model", mock: false } },
    designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
    workflowSnapshot: {
      id: "run-task-sdk-test", startNodeId: "start", rootAgent: { id: agentId, name: "任务联通助手", role: "测试" },
      memoryPolicy: { taskContext: true, longTerm: false },
      nodes: {
        start: { id: "start", title: "接收任务", type: "trigger", next: "extract" },
        extract: { id: "extract", title: "提取金额", type: "ai", next: needsApproval ? "confirm" : "done",
          modelOutput: { format: "json", providerMode: "json", schema, maxRepairAttempts: 0 } },
        ...(needsApproval ? {
          confirm: { id: "confirm", title: "核对处理结果", type: "human", next: "done", rejectNext: "not_approved", approval: { role: "负责人", reason: "核对后交付" } },
          not_approved: { id: "not_approved", title: "记录未确认结果", type: "system", next: "done", system: { kind: "record" } },
        } : {}),
        done: { id: "done", title: "交付结果", type: "end" },
      },
    },
  });
  await db.insert(agents).values({ id: agentId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, name: "任务联通助手", intentText: "验证任务 HTTP 与持久执行的最终交付", status: "published" });
  await db.insert(agentVersions).values({ id: versionId, agentId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, version: 1, status: "production", manifest });
}
function request(requestId: string) {
  return new Request(`${ORIGIN}/api/runs`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ agentId, versionId, requestId, input: { brief: "提取业务金额并保留确认状态" } }) });
}
async function submit(requestId: string) {
  const response = await POST(request(requestId));
  expect(response.status).toBe(202);
  const body = RunTaskStartResult.parse(await response.json());
  if (!body.ok) throw new Error(body.error);
  runId = body.runId;
  const [run] = await db.select({ workflowRunId: runs.workflowRunId }).from(runs).where(eq(runs.id, runId));
  expect(run.workflowRunId).toBeTruthy();
  handle = getRun(run.workflowRunId!);
  return body;
}
async function readResult() {
  const response = await getResult(new Request(`${ORIGIN}/api/runs/${runId}/result`), { params: Promise.resolve({ runId: runId! }) });
  return { response, body: RunTaskResult.parse(await response.json()) };
}
async function decideViaHttp(approvalId: string, note = "已核对实际金额") {
  return decideTaskApproval(new Request(`${ORIGIN}/api/runs/${runId}/approvals/${approvalId}`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ confirmed: true, decision: "approved", note }) }), { params: Promise.resolve({ runId: runId!, approvalId }) });
}

describe("程序化任务到真实持久工作流的交付", () => {
  it.each(["ai", "rule"] as const)("同一 %s 模型步骤返工后，人工确认审核最新成果而非旧参考", async (type) => {
    await prepare(true, false, [1, 2, 3].map((amount) => JSON.stringify({ amount, approved: false })));
    const [version] = await db.select({ manifest: agentVersions.manifest }).from(agentVersions).where(eq(agentVersions.id, versionId!));
    const original = AgentManifest.parse(version.manifest);
    const revised = AgentManifest.parse({ ...original, workflowSnapshot: { ...original.workflowSnapshot,
      nodes: { ...original.workflowSnapshot.nodes,
        extract: { ...original.workflowSnapshot.nodes.extract, type, ...(type === "rule" ? { rule: { kind: "business_rule" } } : {}), next: "check_revision" },
        check_revision: { id: "check_revision", title: "检查返工次数", type: "condition", condition: { source: "context.outputs.extract.amount", operator: "gte", branches: [{ label: "完成本次修订", value: 3, next: "confirm" }], defaultNext: "reference" } },
        reference: { id: "reference", title: "生成参考方案", type: "ai", next: "extract", modelOutput: original.workflowSnapshot.nodes.extract.modelOutput },
      } } });
    expect(resolvePath(revised.workflowSnapshot.nodes.check_revision.condition!.source!, runEvalContext({ input: {}, outputs: { extract: { amount: 3 } } }))).toBe(3);
    await db.update(agentVersions).set({ manifest: revised }).where(eq(agentVersions.id, versionId!));
    await submit(randomUUID());
    const token = await waitForPendingApprovalHook(handle!, runId!);
    const [confirmation] = await db.select({ payload: approvals.payload }).from(approvals).where(eq(approvals.id, token.slice("approval:".length)));
    const review = ApprovalPayload.parse(confirmation.payload).review!;
    expect(review.sourceNodeId).toBe("extract");
    expect(JSON.parse(review.content)).toEqual({ amount: 3, approved: false });
    expect(service!.modelRequests).toHaveLength(3);
    expect(await decideApprovalAction(runId!, token.slice("approval:".length), { decision: "approved" })).toEqual({ ok: true });
    await expect(handle!.returnValue).resolves.toEqual({ status: "completed" });
    expect((await readResult()).body).toMatchObject({ ok: true, task: { result: { extract: { amount: 3, approved: false } } } });
  });

  it("等待审批时从 HTTP 取消真实执行引擎，重复取消不交付过程成果", async () => {
    await prepare(true);
    await submit(randomUUID());
    await waitForPendingApprovalHook(handle!, runId!);
    const request = () => new Request(`${ORIGIN}/api/runs/${runId}/cancel`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ confirmed: true, scope: "execution-chain" }) });
    const context = { params: Promise.resolve({ runId: runId! }) };
    expect((await cancelTask(request(), context)).status).toBe(200);
    await expect(handle!.returnValue).rejects.toThrow();
    const result = await readResult();
    expect(result.response.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, task: { status: "cancelled", ready: true, result: null } });
    expect((await cancelTask(request(), context)).status).toBe(200);
    expect(service!.modelRequests).toHaveLength(1);
    const confirmation = await db.select().from(approvals).where(eq(approvals.runId, runId!));
    expect(confirmation.every((approval) => approval.status === "rejected")).toBe(true);
  });

  it("HTTP 提交实际 SDK 执行，原请求重试不再次调用模型，结果保留零值和否定值", async () => {
    await prepare();
    const requestId = randomUUID();
    const submitted = await submit(requestId);
    await expect(handle!.returnValue).resolves.toEqual({ status: "completed" });
    expect(await submit(requestId)).toEqual(submitted);
    expect(service!.modelRequests).toHaveLength(1);
    const result = await readResult();
    expect(result.response.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, task: { status: "completed", ready: true, result: { extract: { amount: 0, approved: false } }, outputContract } });
    const response = await getStatus(new Request(`${ORIGIN}/api/runs/${runId}`), { params: Promise.resolve({ runId: runId! }) });
    expect(RunTaskStatusResult.parse(await response.json())).toMatchObject({ ok: true, task: { status: "completed", terminal: true, versionId, version: 1 } });
    expect(await db.select().from(runs).where(eq(runs.agentId, agentId!))).toHaveLength(1);
  });
  it("等待确认时不能读取最终成果，按真实 Hook 恢复后交付同一次任务", async () => {
    await prepare(true);
    await submit(randomUUID());
    const token = await waitForPendingApprovalHook(handle!, runId!);
    const [confirmation] = await db.select({ payload: approvals.payload }).from(approvals).where(eq(approvals.id, token.slice("approval:".length)));
    const review = ApprovalPayload.parse(confirmation.payload).review!;
    expect(review).toMatchObject({ sourceNodeId: "extract", sourceTitle: "提取金额", format: "json" });
    expect(JSON.parse(review.content)).toEqual({ amount: 0, approved: false });
    const pending = await readResult();
    expect(pending.response.status).toBe(202);
    expect(pending.body).toMatchObject({ ok: true, task: { status: "waiting_approval", ready: false, result: null } });
    const [waiting] = await db.select().from(runs).where(eq(runs.id, runId!));
    expect(waiting.context).toMatchObject({ outputs: { extract: { amount: 0, approved: false } } });
    const approvalId = token.slice("approval:".length);
    const list = RunApprovalListResult.parse(await (await readApprovals(new Request(`${ORIGIN}/api/runs/${runId}/approvals`), { params: Promise.resolve({ runId: runId! }) })).json());
    expect(list).toMatchObject({ ok: true, items: [{ id: approvalId, state: "pending" }] });
    expect((await decideViaHttp(approvalId)).status).toBe(200);
    await expect(handle!.returnValue).resolves.toEqual({ status: "completed" });
    const completed = await readResult();
    expect(completed.response.status).toBe(200);
    expect(completed.body).toMatchObject({ ok: true, task: { status: "completed", result: { extract: { amount: 0, approved: false } } } });
    expect(service!.modelRequests).toHaveLength(1);
    expect((await decideViaHttp(approvalId)).status).toBe(200);
    expect((await decideViaHttp(approvalId, "另一条备注")).status).toBe(409);
  });
  it("实际引擎等待第二项审批时旧请求可找回，但不能跳过新的确认", async () => {
    await prepare(true);
    const [version] = await db.select({ manifest: agentVersions.manifest }).from(agentVersions).where(eq(agentVersions.id, versionId!));
    const original = AgentManifest.parse(version.manifest);
    const manifest = AgentManifest.parse({ ...original, workflowSnapshot: { ...original.workflowSnapshot, nodes: {
      ...original.workflowSnapshot.nodes, confirm: { ...original.workflowSnapshot.nodes.confirm, next: "confirm_second" },
      confirm_second: { ...original.workflowSnapshot.nodes.confirm, id: "confirm_second", title: "第二次核对", next: "done" },
    } } });
    await db.update(agentVersions).set({ manifest }).where(eq(agentVersions.id, versionId!));
    await submit(randomUUID());
    const first = (await waitForPendingApprovalHook(handle!, runId!)).slice("approval:".length);
    expect((await decideViaHttp(first)).status).toBe(200);
    const second = (await waitForPendingApprovalHook(handle!, runId!, "confirm_second")).slice("approval:".length);
    expect((await decideViaHttp(first)).status).toBe(200);
    const result = RunApprovalGetResult.parse(await (await readApproval(new Request(`${ORIGIN}/api/runs/${runId}/approvals/${first}`), { params: Promise.resolve({ runId: runId!, approvalId: first }) })).json());
    expect(result).toMatchObject({ ok: true, approval: { state: "processed", decisionConsumed: true, runStatus: "waiting_approval" } });
    const [pendingSecond] = await db.select({ status: approvals.status }).from(approvals).where(eq(approvals.id, second));
    expect(pendingSecond.status).toBe("pending");
    expect((await decideViaHttp(second)).status).toBe(200);
    await expect(handle!.returnValue).resolves.toEqual({ status: "completed" });
    expect((await decideViaHttp(first)).status).toBe(200);
    expect(service!.modelRequests).toHaveLength(1);
  });
  it("实际模型输出不符合契约时任务失败，不把接收或读取成功伪装为业务成功", async () => {
    await prepare(false, true);
    await submit(randomUUID());
    await expect(handle!.returnValue).rejects.toThrow("模型结果未满足字段契约");
    await vi.waitFor(async () => {
      const [run] = await db.select({ status: runs.status }).from(runs).where(eq(runs.id, runId!));
      expect(run.status).toBe("failed");
    }, { timeout: 30_000, interval: 500 });
    const result = await readResult();
    expect(result.response.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, task: { status: "failed", ready: true, result: null } });
    expect(JSON.stringify(result.body)).not.toContain("sk-private-invalid");
    expect(service!.modelRequests).toHaveLength(1);
  });
  it("深层成果从真实模型步骤经审批到最终交付完整保留，只隐藏凭据", async () => {
    let nested: Record<string, unknown> = { count: 0, accepted: false, contact: "finance@example.com", apiKey: "private-deep-key" };
    for (let index = 0; index < 26; index++) nested = { nested };
    await prepare(true, false, [JSON.stringify({ amount: 0, approved: false, nested })]);
    const deliveryContract = { fields: [...outputContract.fields, { path: "extract.nested", label: "业务明细", required: true }] };
    const [version] = await db.select({ manifest: agentVersions.manifest }).from(agentVersions).where(eq(agentVersions.id, versionId!));
    const original = AgentManifest.parse(version.manifest);
    const manifest = AgentManifest.parse({ ...original, outputContract: deliveryContract, workflowSnapshot: { ...original.workflowSnapshot, nodes: {
      ...original.workflowSnapshot.nodes,
      extract: { ...original.workflowSnapshot.nodes.extract, modelOutput: { ...original.workflowSnapshot.nodes.extract.modelOutput!, schema: { ...schema, additionalProperties: true } } },
    } } });
    expect(projectWorkflowResult({ extract: { amount: 0, approved: false, nested } }, deliveryContract.fields)).toMatchObject({ ok: true, result: { extract: { nested } } });
    await db.update(agentVersions).set({ manifest }).where(eq(agentVersions.id, versionId!));
    await submit(randomUUID());
    const approvalId = (await waitForPendingApprovalHook(handle!, runId!)).slice("approval:".length);
    const review = RunApprovalGetResult.parse(await (await readApproval(new Request(`${ORIGIN}/api/runs/${runId}/approvals/${approvalId}`), { params: Promise.resolve({ runId: runId!, approvalId }) })).json());
    if (!review.ok) throw new Error(review.error);
    const reviewed = JSON.parse(review.approval.review!.content) as Record<string, unknown>;
    expect((await decideViaHttp(approvalId)).status).toBe(200);
    await expect(handle!.returnValue).resolves.toEqual({ status: "completed" });
    const completed = (await readResult()).body; if (!completed.ok) throw new Error(completed.error);
    const delivered = (completed.task.result as Record<string, unknown>).extract;
    expect(delivered).toEqual(reviewed);
    const serialized = JSON.stringify(delivered);
    expect(serialized).toContain('"count":0'); expect(serialized).toContain('"accepted":false'); expect(serialized).toContain("finance@example.com");
    expect(serialized).not.toContain("private-deep-key"); expect(serialized).not.toContain("深层内容");
    expect(service!.modelRequests).toHaveLength(1);
  });
});
