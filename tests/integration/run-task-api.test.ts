import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ start: vi.fn(), cancel: vi.fn() }));
vi.mock("workflow/api", () => ({ start: mocks.start }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

import { POST } from "@/app/api/runs/route";
import { GET as getStatus } from "@/app/api/runs/[runId]/route";
import { GET as getResult } from "@/app/api/runs/[runId]/result/route";
import { AgentManifest } from "@/contracts/manifest";
import { RunTaskResult, RunTaskStartResult, RunTaskStatusResult } from "@/contracts/run-task";
import { agents, agentVersions, runs } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { startRunAction } from "@/server/actions/start-run";
import { getRunTaskResult, getRunTaskStatus } from "@/server/queries/run-tasks";
import { createRunStartLease, RUN_START_LEASE_MS, withRunStartLease } from "@/server/services/run-start-lease";

const ORIGIN = "http://localhost";
const input = { amount: 0, approved: false };
let agentId: string;
let versionId: string;
let ownedAgents: string[] = [];
let ownedVersions: string[] = [];
function manifest(id: string) {
  return AgentManifest.parse({
    schemaVersion: "4.0", workflowFingerprint: "run-task-api-test",
    inputContract: { fields: [{ name: "amount", type: "number", required: true }, { name: "approved", type: "boolean", required: true }] },
    outputContract: { fields: [{ path: "amount", label: "金额", required: true, sourceNodeId: "output" }] },
    resourceSelection: { model: { modelId: "mock", mock: true } },
    designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
    workflowSnapshot: {
      id: "run-task-api-test", startNodeId: "start", rootAgent: { id, name: "任务接入助手", role: "测试" },
      memoryPolicy: { taskContext: true, longTerm: false },
      nodes: { start: { id: "start", title: "开始", type: "trigger", next: "output" },
        output: { id: "output", title: "登记金额", type: "system", system: { kind: "record" }, next: "done" },
        done: { id: "done", title: "结束", type: "end", next: null } },
    },
  });
}
async function seed(workspaceId = DEMO_WORKSPACE_ID) {
  const id = randomUUID();
  const version = randomUUID();
  ownedAgents.push(id);
  ownedVersions.push(version);
  await db.insert(agents).values({ id, workspaceId, createdBy: DEMO_USER_ID, name: "任务接入助手", intentText: "测试任务接入与冻结版本结果查询", status: "published" });
  await db.insert(agentVersions).values({ id: version, agentId: id, workspaceId, createdBy: DEMO_USER_ID, version: 1, status: "production", manifest: manifest(id) });
  return { agentId: id, versionId: version };
}
function request(requestId: string = randomUUID(), version?: string, payload: unknown = input, agent = agentId) {
  return new Request(`${ORIGIN}/api/runs`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ agentId: agent, requestId, input: payload, ...(version ? { versionId: version } : {}) }) });
}
async function submit(requestId: string = randomUUID(), version?: string, payload: unknown = input, agent = agentId) {
  const response = await POST(request(requestId, version, payload, agent));
  return { response, body: RunTaskStartResult.parse(await response.json()) };
}
async function started() {
  const submitted = await submit();
  if (!submitted.body.ok) throw new Error(submitted.body.error);
  return submitted.body.runId;
}
beforeEach(async () => {
  mocks.start.mockReset().mockResolvedValue({ runId: "wrun_task_api_test", cancel: mocks.cancel });
  mocks.cancel.mockReset().mockResolvedValue(undefined);
  ({ agentId, versionId } = await seed());
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (ownedAgents.length) await db.delete(runs).where(inArray(runs.agentId, ownedAgents));
  if (ownedVersions.length) await db.delete(agentVersions).where(inArray(agentVersions.id, ownedVersions));
  if (ownedAgents.length) await db.delete(agents).where(inArray(agents.id, ownedAgents));
  ownedAgents = [];
  ownedVersions = [];
});

describe("任务接口的真实数据库边界", () => {
  it("页面和 HTTP 使用同一请求标识只创建一条运行并启动一次", async () => {
    const requestId = randomUUID();
    const first = await submit(requestId);
    expect(first.response.status).toBe(202);
    if (!first.body.ok) throw new Error(first.body.error);
    expect(await startRunAction({ agentId, requestId, input })).toEqual({ ok: true, runId: first.body.runId });
    expect((await submit(requestId)).body).toEqual(first.body);
    expect((await submit(requestId.toUpperCase(), versionId.toUpperCase(), input, agentId.toUpperCase())).body).toEqual(first.body);
    expect(mocks.start).toHaveBeenCalledOnce();
    const stored = await db.select().from(runs).where(eq(runs.agentId, agentId));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ input, versionId, sourceType: "manual", sourceKey: `manual:${requestId}` });
  });
  it("并发相同请求领取同一运行，改变业务输入返回冲突", async () => {
    const requestId = randomUUID();
    const results = await Promise.all([submit(requestId), submit(requestId)]);
    expect(results.every((result) => result.response.status === 202)).toBe(true);
    expect(results[0].body).toEqual(results[1].body);
    expect(mocks.start).toHaveBeenCalledOnce();
    const changed = await submit(requestId, undefined, { ...input, amount: 1 });
    expect(changed.response.status).toBe(409);
    expect(changed.body).toMatchObject({ ok: false, error: "运行输入已改变，请重新发起" });
  });
  it("事务提交与对账响应丢失后沿用原请求找回任务，不再创建", async () => {
    const requestId = randomUUID();
    const transaction = db.transaction.bind(db);
    vi.spyOn(db, "transaction").mockImplementationOnce(async (callback) => {
      await transaction(callback);
      vi.spyOn(db, "select").mockImplementationOnce(() => { throw new Error("模拟提交后对账暂时不可用"); });
      throw new Error("模拟事务提交响应丢失");
    });
    const first = await submit(requestId);
    expect(first.response.status).toBe(503);
    expect(first.body).toMatchObject({ ok: false, retryable: true });
    expect(first.response.headers.get("retry-after")).toBe("2");
    const retried = await submit(requestId);
    expect(retried.response.status).toBe(202);
    const stored = await db.select().from(runs).where(eq(runs.sourceKey, `manual:${requestId}`));
    expect(stored).toHaveLength(1);
    expect(retried.body).toMatchObject({ ok: true, runId: stored[0].id });
    expect(mocks.start).not.toHaveBeenCalled();
    await db.update(runs).set({ stepStates: withRunStartLease({}, createRunStartLease(new Date(Date.now() - RUN_START_LEASE_MS - 1))) }).where(eq(runs.id, stored[0].id));
    expect((await submit(requestId)).body).toEqual(retried.body);
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(await db.select().from(runs).where(eq(runs.sourceKey, `manual:${requestId}`))).toHaveLength(1);
  });
  it("指定版本冲突不改写原运行，未指定版本重试不会随新发布漂移", async () => {
    const requestId = randomUUID();
    const first = await submit(requestId, versionId);
    const nextVersion = randomUUID();
    ownedVersions.push(nextVersion);
    await db.update(agentVersions).set({ status: "retired" }).where(eq(agentVersions.id, versionId));
    await db.insert(agentVersions).values({ id: nextVersion, agentId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, version: 2, status: "production", manifest: manifest(agentId) });
    expect((await submit(requestId, nextVersion)).response.status).toBe(409);
    expect((await submit(requestId)).body).toEqual(first.body);
    expect((await submit(requestId, versionId)).body).toEqual(first.body);
    expect(mocks.start).toHaveBeenCalledOnce();
  });
  it("并发同一请求指定不同版本，只接收一个版本且拒绝另一版本", async () => {
    const second = randomUUID();
    ownedVersions.push(second);
    await db.insert(agentVersions).values({ id: second, agentId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, version: 2, status: "production", manifest: manifest(agentId) });
    const requestId = randomUUID();
    const results = await Promise.all([submit(requestId, versionId), submit(requestId, second)]);
    expect(results.map((result) => result.response.status).sort()).toEqual([202, 409]);
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(await db.select().from(runs).where(eq(runs.sourceKey, `manual:${requestId}`))).toHaveLength(1);
  });
  it("输入契约不通过或未获验收的候选版本不创建任务", async () => {
    expect((await submit(randomUUID(), undefined, { amount: "错误金额", approved: false })).response.status).toBe(409);
    await db.update(agentVersions).set({ status: "candidate" }).where(eq(agentVersions.id, versionId));
    expect((await submit(randomUUID(), versionId)).response.status).toBe(409);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(await db.select().from(runs).where(eq(runs.agentId, agentId))).toEqual([]);
  });
  it("状态投影不读取或返回输入、执行上下文、结果或完整版本", async () => {
    const runId = await started();
    await db.update(runs).set({ context: { private: "private-context-value" }, result: { private: "private-result-value" } }).where(eq(runs.id, runId));
    const select = vi.spyOn(db, "select");
    const task = await getRunTaskStatus(runId, DEMO_WORKSPACE_ID);
    expect(Object.keys(select.mock.calls[0]?.[0] ?? {})).toEqual(["runId", "agentId", "agentName", "versionId", "version", "status", "error", "startedAt", "finishedAt"]);
    expect(task).toMatchObject({ runId, agentId, versionId, version: 1, status: "queued", terminal: false });
    expect(JSON.stringify(task)).not.toMatch(/private-context|private-result|input|manifest|stepStates/);
  });
  it.each(["running", "waiting_approval", "waiting_event", "failed", "cancelled"] as const)("状态 %s 的存储中即使有过程结果也不交付", async (status) => {
    const runId = await started();
    await db.update(runs).set({ status, result: { private: "partial-never-delivered" }, error: "token: private-token-123456" }).where(eq(runs.id, runId));
    const response = await getResult(new Request(`${ORIGIN}/api/runs/${runId}/result`), { params: Promise.resolve({ runId }) });
    expect(response.status).toBe(["failed", "cancelled"].includes(status) ? 200 : 202);
    const body = RunTaskResult.parse(await response.json());
    expect(body).toMatchObject({ ok: true, task: { status, result: null, ready: ["failed", "cancelled"].includes(status) } });
    expect(JSON.stringify(body)).not.toMatch(/partial-never|private-token/);
  });
  it("完成后的 HTTP 状态和业务对象基于原冻结版本并隐藏凭据", async () => {
    const runId = await started();
    const finishedAt = new Date("2026-10-08T12:00:00Z");
    await db.update(runs).set({ status: "completed", result: { ...input, rows: [0, false], apiKey: "private-key-value" }, error: "旧错误", startedAt: finishedAt, finishedAt }).where(eq(runs.id, runId));
    const context = { params: Promise.resolve({ runId }) };
    const statusResponse = await getStatus(new Request(`${ORIGIN}/api/runs/${runId}`), context);
    expect(statusResponse.status).toBe(200);
    expect(RunTaskStatusResult.parse(await statusResponse.json())).toMatchObject({ ok: true, task: { status: "completed", terminal: true, error: null, versionId, finishedAt: finishedAt.toISOString() } });
    const resultResponse = await getResult(new Request(`${ORIGIN}/api/runs/${runId}/result`), context);
    expect(resultResponse.status).toBe(200);
    expect(RunTaskResult.parse(await resultResponse.json())).toMatchObject({ ok: true, task: { status: "completed", ready: true, error: null, result: { ...input, rows: [0, false], apiKey: "[已隐藏敏感信息]" }, outputContract: { fields: [{ path: "amount", label: "金额", required: true }] } } });
  });
  it("查询与提交均不跨工作区，非法标识不触及数据库", async () => {
    const otherWorkspace = randomUUID();
    const other = await seed(otherWorkspace);
    const [otherRun] = await db.insert(runs).values({ workspaceId: otherWorkspace, createdBy: DEMO_USER_ID, agentId: other.agentId, versionId: other.versionId, status: "completed", result: { hidden: "private-workspace-result" } }).returning({ id: runs.id });
    const response = await getResult(new Request(`${ORIGIN}/api/runs/${otherRun.id}/result`), { params: Promise.resolve({ runId: otherRun.id }) });
    expect(response.status).toBe(404);
    expect(await getRunTaskStatus(otherRun.id, DEMO_WORKSPACE_ID)).toBeNull();
    expect(await getRunTaskResult(otherRun.id, otherWorkspace)).toMatchObject({ result: { hidden: "private-workspace-result" } });
    expect((await submit(randomUUID(), other.versionId, input, other.agentId)).response.status).toBe(409);
    const select = vi.spyOn(db, "select");
    expect(await getRunTaskStatus("bad", DEMO_WORKSPACE_ID)).toBeNull();
    expect(await getRunTaskResult(randomUUID(), "bad")).toBeNull();
    expect(select).not.toHaveBeenCalled();
  });
});
