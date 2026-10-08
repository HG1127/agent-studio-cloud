import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { startMock, cancelMock } = vi.hoisted(() => ({ startMock: vi.fn(), cancelMock: vi.fn() }));
vi.mock("workflow/api", () => ({ start: startMock }));

import { AgentManifest } from "@/contracts/manifest";
import { agents, agentVersions, evaluationCaseResults, evaluationCases, evaluationRuns, knowledgeSources, runs } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { resumeQueuedRunStartCore, startRunCore } from "@/server/services/start-run-core";
import { MAX_STALE_RUNS_PER_TICK, recoverStaleQueuedRuns } from "@/server/services/recover-stale-runs";
import { createRunStartLease, MAX_RUN_START_ATTEMPTS, readRunStartLease, RUN_START_LEASE_MS, withRunStartLease } from "@/server/services/run-start-lease";
import { initializeRun } from "@/server/steps/run-state";

const AGENT_ID = "00000000-0000-4000-8000-0000000007a1";
const VERSION_ID = "00000000-0000-4000-8000-0000000007a2";
const EVALUATION_ID = "00000000-0000-4000-8000-0000000007a3";
const CASE_ID = "00000000-0000-4000-8000-0000000007a4";
const CROSS_VERSION_ID = "00000000-0000-4000-8000-0000000007a5";
const OTHER_WS = "00000000-0000-4000-8000-0000000007af";
const OTHER_AGENT_ID = "00000000-0000-4000-8000-0000000007b0";
const OTHER_VERSION_ID = "00000000-0000-4000-8000-0000000007b1";
const KNOWLEDGE_SOURCE_ID = "00000000-0000-4000-8000-0000000007b2";
const manifest = AgentManifest.parse({
  schemaVersion: "4.0",
  workflowFingerprint: "7".repeat(64),
  inputContract: { fields: [] },
  resourceSelection: { model: { modelId: "mock", mock: true } },
  designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
  workflowSnapshot: {
    id: "start-recovery",
    startNodeId: "start",
    rootAgent: { id: AGENT_ID, name: "启动恢复测试", role: "测试" },
    memoryPolicy: { taskContext: true, longTerm: false },
    nodes: {
      start: { id: "start", title: "开始", type: "trigger", next: "done" },
      done: { id: "done", title: "结束", type: "end", next: null },
    },
  },
});

async function cleanup() {
  await db.delete(runs).where(inArray(runs.agentId, [AGENT_ID, OTHER_AGENT_ID]));
  await db.delete(knowledgeSources).where(eq(knowledgeSources.id, KNOWLEDGE_SOURCE_ID));
  await db.delete(evaluationCaseResults).where(eq(evaluationCaseResults.evaluationRunId, EVALUATION_ID));
  await db.delete(evaluationRuns).where(eq(evaluationRuns.id, EVALUATION_ID));
  await db.delete(evaluationCases).where(eq(evaluationCases.id, CASE_ID));
  await db.delete(agentVersions).where(inArray(agentVersions.id, [VERSION_ID, CROSS_VERSION_ID, OTHER_VERSION_ID]));
  await db.delete(agents).where(inArray(agents.id, [AGENT_ID, OTHER_AGENT_ID]));
}

beforeEach(async () => {
  await cleanup();
  await db.insert(agents).values({
    id: AGENT_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
    name: "启动恢复测试", intentText: "验证启动句柄保存失败时的状态恢复", status: "published",
  });
  await db.insert(agentVersions).values({
    id: VERSION_ID, agentId: AGENT_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
    version: 1, status: "production", manifest,
  });
  cancelMock.mockReset().mockResolvedValue(undefined);
  startMock.mockReset().mockResolvedValue({ runId: "wrun_test_handle", cancel: cancelMock });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanup();
});

describe("运行启动句柄恢复", () => {
  it("知识步骤的发布快照没有可用资料时不创建运行", async () => {
    const knowledgeManifest = AgentManifest.parse({
      ...manifest,
      workflowFingerprint: "k".repeat(64),
      knowledgeSnapshot: [],
      workflowSnapshot: {
        ...manifest.workflowSnapshot,
        nodes: {
          start: { id: "start", title: "开始", type: "trigger", next: "knowledge" },
          knowledge: { id: "knowledge", title: "查询制度", type: "knowledge", next: "done", knowledge: { space: "业务资料库" } },
          done: { id: "done", title: "结束", type: "end", next: null },
        },
      },
    });
    await db.update(agentVersions).set({ manifest: knowledgeManifest }).where(eq(agentVersions.id, VERSION_ID));

    const result = await startRunCore({ agentId: AGENT_ID, input: {} });

    expect(result).toEqual({
      ok: false,
      error: "「查询制度」需要知识资料，但这个版本的发布快照中没有可用资料；请恢复资料，或上传后重新发布",
    });
    expect(startMock).not.toHaveBeenCalled();
    expect(await db.select().from(runs).where(eq(runs.agentId, AGENT_ID))).toEqual([]);
  });

  it("相同来源键重试时复用已有运行且不重复启动工作流", async () => {
    const first = await startRunCore({ agentId: AGENT_ID, input: {}, sourceType: "evaluation", sourceKey: "evaluation:00000000-0000-4000-8000-000000000701:00000000-0000-4000-8000-000000000702" });
    const second = await startRunCore({ agentId: AGENT_ID, input: {}, sourceType: "evaluation", sourceKey: "evaluation:00000000-0000-4000-8000-000000000701:00000000-0000-4000-8000-000000000702" });

    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    expect(startMock).toHaveBeenCalledOnce();
    const [stored] = await db.select().from(runs).where(eq(runs.id, first.ok ? first.runId : ""));
    expect(stored.workflowRunId).toBe("wrun_test_handle");
    expect(readRunStartLease(stored.stepStates)?.token).toBe(startMock.mock.calls[0]?.[1]?.[3]?.startToken);
  });

  it("同一来源键不能跨助手复用已有运行", async () => {
    await db.insert(agents).values({
      id: OTHER_AGENT_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
      name: "另一个测试助手", intentText: "验证请求标识不能跨助手复用", status: "published",
    });
    await db.insert(agentVersions).values({
      id: OTHER_VERSION_ID, agentId: OTHER_AGENT_ID, workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID, version: 1, status: "production",
      manifest: AgentManifest.parse({
        ...manifest,
        workflowSnapshot: {
          ...manifest.workflowSnapshot,
          rootAgent: { ...manifest.workflowSnapshot.rootAgent, id: OTHER_AGENT_ID },
        },
      }),
    });
    const sourceKey = "manual:00000000-0000-4000-8000-0000000007b2";
    const first = await startRunCore({ agentId: AGENT_ID, input: {}, sourceKey });
    const second = await startRunCore({ agentId: OTHER_AGENT_ID, input: {}, sourceKey });

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, error: "这项请求标识已经用于另一项运行，请重新发起" });
    expect(startMock).toHaveBeenCalledOnce();
    const stored = await db.select().from(runs).where(eq(runs.sourceKey, sourceKey));
    expect(stored).toHaveLength(1);
    expect(stored[0].agentId).toBe(AGENT_ID);
  });

  it("同一来源键不能跨运行来源复用已有运行", async () => {
    const sourceKey = "manual:00000000-0000-4000-8000-0000000007b3";
    const first = await startRunCore({ agentId: AGENT_ID, input: {}, sourceKey });
    const second = await startRunCore({ agentId: AGENT_ID, input: {}, sourceType: "evaluation", sourceKey });

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, error: "这项请求标识已经用于另一项运行，请重新发起" });
    expect(startMock).toHaveBeenCalledOnce();
  });

  it("手动运行相同请求标识只复用输入一致的运行", async () => {
    const sourceKey = "manual:00000000-0000-4000-8000-0000000007b4";
    const input = { brief: "原始输入", options: { priority: 1, tags: ["甲", "乙"] } };
    const first = await startRunCore({ agentId: AGENT_ID, input, sourceKey });
    const same = await startRunCore({
      agentId: AGENT_ID,
      input: { options: { tags: ["甲", "乙"], priority: 1 }, brief: "原始输入" },
      sourceKey,
    });
    const changed = await startRunCore({
      agentId: AGENT_ID,
      input: { ...input, brief: "修改后的输入" },
      sourceKey,
    });

    expect(first.ok).toBe(true);
    expect(same).toEqual(first);
    expect(changed).toEqual({ ok: false, error: "运行输入已改变，请重新发起" });
    expect(startMock).toHaveBeenCalledOnce();
    const stored = await db.select().from(runs).where(eq(runs.sourceKey, sourceKey));
    expect(stored).toHaveLength(1);
    expect(stored[0].input).toEqual(input);
  });

  it("重试已创建的运行不受后来发布的输入契约影响", async () => {
    const sourceKey = "manual:00000000-0000-4000-8000-0000000007b5";
    const first = await startRunCore({ agentId: AGENT_ID, input: {}, sourceKey });
    expect(first.ok).toBe(true);

    await db.update(agentVersions).set({ status: "retired" }).where(eq(agentVersions.id, VERSION_ID));
    await db.insert(agentVersions).values({
      id: CROSS_VERSION_ID,
      agentId: AGENT_ID,
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      version: 2,
      status: "production",
      manifest: AgentManifest.parse({
        ...manifest,
        inputContract: { fields: [{ name: "brief", label: "任务说明", required: true, type: "string" }] },
      }),
    });

    const retried = await startRunCore({ agentId: AGENT_ID, input: {}, sourceKey });

    expect(retried).toEqual(first);
    expect(startMock).toHaveBeenCalledOnce();
    const stored = await db.select().from(runs).where(eq(runs.sourceKey, sourceKey));
    expect(stored).toHaveLength(1);
    expect(stored[0].versionId).toBe(VERSION_ID);
  });

  it("同一请求显式指定另一个版本时拒绝复用，省略版本仍找回原运行", async () => {
    const sourceKey = "manual:00000000-0000-4000-8000-0000000007e1";
    const first = await startRunCore({ agentId: AGENT_ID, versionId: VERSION_ID, input: {}, sourceKey });
    expect(first.ok).toBe(true);
    await db.insert(agentVersions).values({ id: CROSS_VERSION_ID, agentId: AGENT_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, version: 2, status: "production", manifest });
    expect(await startRunCore({ agentId: AGENT_ID, versionId: CROSS_VERSION_ID, input: {}, sourceKey })).toEqual({ ok: false, error: "这项请求标识已用于另一个版本，请重新发起" });
    expect(await startRunCore({ agentId: AGENT_ID, versionId: VERSION_ID, input: {}, sourceKey })).toEqual(first);
    expect(await startRunCore({ agentId: AGENT_ID, input: {}, sourceKey })).toEqual(first);
    expect(startMock).toHaveBeenCalledOnce();
    expect(await db.select().from(runs).where(eq(runs.sourceKey, sourceKey))).toHaveLength(1);
  });

  it("已创建运行在助手归档后仍可按原请求标识找回", async () => {
    const sourceKey = "manual:00000000-0000-4000-8000-0000000007b6";
    const first = await startRunCore({ agentId: AGENT_ID, input: {}, sourceKey });
    expect(first.ok).toBe(true);
    await db.update(agents).set({ archivedAt: new Date() }).where(eq(agents.id, AGENT_ID));

    expect(await startRunCore({ agentId: AGENT_ID, input: {}, sourceKey })).toEqual(first);
    expect(await startRunCore({ agentId: AGENT_ID, input: {} })).toEqual({
      ok: false,
      error: "找不到这个助手，请刷新页面后重试",
    });
    expect(startMock).toHaveBeenCalledOnce();
  });

  it("运行事务已提交但提交回执丢失时按原请求标识找回运行", async () => {
    const sourceKey = "manual:00000000-0000-4000-8000-0000000007d3";
    const transaction = db.transaction.bind(db);
    vi.spyOn(db, "transaction").mockImplementationOnce(async (callback) => {
      await transaction(callback);
      throw new Error("模拟事务提交回执丢失");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await startRunCore({ agentId: AGENT_ID, input: {}, sourceKey });

    expect(result).toMatchObject({ ok: true, runId: expect.any(String) });
    const stored = await db.select().from(runs).where(eq(runs.sourceKey, sourceKey));
    expect(stored).toHaveLength(1);
    expect(result.ok && result.runId).toBe(stored[0].id);
    expect(await startRunCore({ agentId: AGENT_ID, input: {}, sourceKey })).toEqual(result);
    expect(startMock).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("提交与对账回执均暂时不可用时要求沿用原请求标识重试", async () => {
    const sourceKey = "manual:00000000-0000-4000-8000-0000000007d4";
    const transaction = db.transaction.bind(db);
    vi.spyOn(db, "transaction").mockImplementationOnce(async (callback) => {
      await transaction(callback);
      vi.spyOn(db, "select").mockImplementationOnce(() => { throw new Error("模拟对账查询暂时失败"); });
      throw new Error("模拟事务提交回执丢失");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const first = await startRunCore({ agentId: AGENT_ID, input: {}, sourceKey });

    expect(first).toEqual({ ok: false, error: "运行启动状态待确认，请稍后用同一次请求重试", retryable: true });
    const retried = await startRunCore({ agentId: AGENT_ID, input: {}, sourceKey });
    expect(retried).toMatchObject({ ok: true, runId: expect.any(String) });
    const stored = await db.select().from(runs).where(eq(runs.sourceKey, sourceKey));
    expect(stored).toHaveLength(1);
    expect(retried.ok && retried.runId).toBe(stored[0].id);
    expect(startMock).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("普通运行在读取助手后才发生停用时不创建运行", async () => {
    const transaction = db.transaction.bind(db);
    vi.spyOn(db, "transaction").mockImplementationOnce((callback) => transaction(async (tx) => {
      await tx.update(agents).set({ archivedAt: new Date() }).where(eq(agents.id, AGENT_ID));
      return callback(tx);
    }));

    const result = await startRunCore({ agentId: AGENT_ID, input: {} });

    expect(result).toEqual({ ok: false, error: "助手或协作助手已停用，请刷新页面后重试" });
    expect(startMock).not.toHaveBeenCalled();
    expect(await db.select().from(runs).where(eq(runs.agentId, AGENT_ID))).toEqual([]);
  });

  it("相同来源键遇到过期排队记录时接管原运行而不新建记录", async () => {
    const sourceKey = "evaluation:00000000-0000-4000-8000-000000000703:00000000-0000-4000-8000-000000000704";
    const staleAt = new Date(Date.now() - RUN_START_LEASE_MS * 2);
    const staleLease = createRunStartLease(staleAt);
    const [existing] = await db.insert(runs).values({
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      agentId: AGENT_ID,
      versionId: VERSION_ID,
      status: "queued",
      input: { request: "原始输入" },
      stepStates: withRunStartLease({}, staleLease),
      sourceType: "evaluation",
      sourceKey,
      updatedAt: staleAt,
    }).returning({ id: runs.id });

    const result = await startRunCore({ agentId: AGENT_ID, input: { request: "重复触发" }, sourceType: "evaluation", sourceKey });

    expect(result).toEqual({ ok: true, runId: existing.id });
    expect(startMock).toHaveBeenCalledOnce();
    expect(startMock.mock.calls[0]?.[1]).toEqual(expect.arrayContaining([
      existing.id,
      expect.any(Object),
      { request: "原始输入" },
      expect.objectContaining({ startToken: expect.not.stringMatching(staleLease.token) }),
    ]));
    expect(await db.select().from(runs).where(eq(runs.sourceKey, sourceKey))).toHaveLength(1);
  });

  it("自动接管达到启动次数上限后终结排队运行", async () => {
    const staleAt = new Date(Date.now() - RUN_START_LEASE_MS * 2);
    const [pending] = await db.insert(runs).values({
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      agentId: AGENT_ID,
      versionId: VERSION_ID,
      status: "queued",
      input: {},
      stepStates: withRunStartLease({}, createRunStartLease(staleAt, MAX_RUN_START_ATTEMPTS)),
      updatedAt: staleAt,
    }).returning({ id: runs.id });

    await recoverStaleQueuedRuns();

    const [failed] = await db.select().from(runs).where(eq(runs.id, pending.id));
    expect(failed).toMatchObject({ status: "failed", error: "运行多次启动未获确认，请重新发起" });
    expect(readRunStartLease(failed.stepStates)).toBeNull();
    expect(startMock).not.toHaveBeenCalled();
  });

  it("每轮只接管固定数量的过期排队运行", async () => {
    const staleAt = new Date(Date.now() - RUN_START_LEASE_MS * 2);
    const inserted = await db.insert(runs).values(Array.from({ length: MAX_STALE_RUNS_PER_TICK + 1 }, () => ({
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      agentId: AGENT_ID,
      versionId: VERSION_ID,
      status: "queued",
      input: {},
      stepStates: withRunStartLease({}, createRunStartLease(staleAt)),
      updatedAt: staleAt,
    }))).returning({ id: runs.id });

    await recoverStaleQueuedRuns();

    const after = await db.select().from(runs).where(inArray(runs.id, inserted.map((run) => run.id)));
    expect(after.filter((run) => run.workflowRunId === "wrun_test_handle")).toHaveLength(MAX_STALE_RUNS_PER_TICK);
    expect(after.filter((run) => run.workflowRunId === null)).toHaveLength(1);
    expect(startMock).toHaveBeenCalledTimes(MAX_STALE_RUNS_PER_TICK);
  });

  it("助手停用后的过期排队运行不永久积压，也不会启动工作流", async () => {
    const staleAt = new Date(Date.now() - RUN_START_LEASE_MS * 2);
    const [pending] = await db.insert(runs).values({
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      agentId: AGENT_ID,
      versionId: VERSION_ID,
      status: "queued",
      input: {},
      stepStates: withRunStartLease({}, createRunStartLease(staleAt)),
      updatedAt: staleAt,
    }).returning({ id: runs.id });
    await db.update(agents).set({ archivedAt: new Date() }).where(eq(agents.id, AGENT_ID));

    await recoverStaleQueuedRuns();

    const [failed] = await db.select().from(runs).where(eq(runs.id, pending.id));
    expect(failed).toMatchObject({ status: "failed", error: "助手已停用，无法继续启动" });
    expect(readRunStartLease(failed.stepStates)).toBeNull();
    expect(startMock).not.toHaveBeenCalled();
  });

  it("恢复过期排队运行时重新校验冻结版本的输入契约", async () => {
    const requiredInputManifest = AgentManifest.parse({
      ...manifest,
      workflowFingerprint: "i".repeat(64),
      inputContract: {
        fields: [{ name: "brief", label: "任务说明", required: true, type: "string" }],
      },
    });
    await db.update(agentVersions).set({ manifest: requiredInputManifest }).where(eq(agentVersions.id, VERSION_ID));
    const staleAt = new Date(Date.now() - RUN_START_LEASE_MS * 2);
    const [existing] = await db.insert(runs).values({
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      agentId: AGENT_ID,
      versionId: VERSION_ID,
      status: "queued",
      input: {},
      stepStates: withRunStartLease({}, createRunStartLease(staleAt)),
      updatedAt: staleAt,
    }).returning({ id: runs.id });

    const result = await resumeQueuedRunStartCore(existing.id);

    expect(result).toEqual({ ok: false, error: "运行输入“任务说明”不能为空" });
    expect(startMock).not.toHaveBeenCalled();
    const [failed] = await db.select().from(runs).where(eq(runs.id, existing.id));
    expect(failed).toMatchObject({ status: "failed", error: "运行输入“任务说明”不能为空" });
    expect(readRunStartLease(failed.stepStates)).toBeNull();
  });

  it("恢复启动的前置检查暂时异常时保留排队运行和接管租约", async () => {
    const knowledgeManifest = AgentManifest.parse({
      ...manifest,
      workflowFingerprint: "x".repeat(64),
      knowledgeSnapshot: [KNOWLEDGE_SOURCE_ID],
      workflowSnapshot: {
        ...manifest.workflowSnapshot,
        nodes: {
          start: { id: "start", title: "开始", type: "trigger", next: "knowledge" },
          knowledge: { id: "knowledge", title: "查询制度", type: "knowledge", next: "done", knowledge: { space: "业务资料库" } },
          done: { id: "done", title: "结束", type: "end", next: null },
        },
      },
    });
    await db.update(agentVersions).set({ manifest: knowledgeManifest }).where(eq(agentVersions.id, VERSION_ID));
    await db.insert(knowledgeSources).values({
      id: KNOWLEDGE_SOURCE_ID,
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      name: "前置检查资料",
      mime: "text/plain",
      sizeBytes: 10,
      sha256: "f".repeat(64),
      status: "indexed",
    });
    const staleAt = new Date(Date.now() - RUN_START_LEASE_MS * 2);
    const [existing] = await db.insert(runs).values({
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      agentId: AGENT_ID,
      versionId: VERSION_ID,
      status: "queued",
      input: {},
      stepStates: withRunStartLease({}, createRunStartLease(staleAt)),
      updatedAt: staleAt,
    }).returning({ id: runs.id });
    const originalSelect = db.select.bind(db);
    vi.spyOn(db, "select")
      .mockImplementationOnce(originalSelect)
      .mockImplementationOnce(() => { throw new Error("模拟前置检查数据库异常"); });

    const result = await resumeQueuedRunStartCore(existing.id);

    expect(result).toEqual({ ok: true, runId: existing.id });
    expect(startMock).not.toHaveBeenCalled();
    vi.mocked(db.select).mockRestore();
    const [pending] = await db.select().from(runs).where(eq(runs.id, existing.id));
    expect(pending).toMatchObject({ status: "queued", error: null, workflowRunId: null });
    expect(readRunStartLease(pending.stepStates)?.attempt).toBe(2);
    await db.update(runs)
      .set({
        stepStates: withRunStartLease(pending.stepStates, createRunStartLease(staleAt, 2)),
        updatedAt: staleAt,
      })
      .where(eq(runs.id, existing.id));
    await recoverStaleQueuedRuns();
    const [recovered] = await db.select().from(runs).where(eq(runs.id, existing.id));
    expect(recovered).toMatchObject({ status: "queued", workflowRunId: "wrun_test_handle", error: null });
    expect(readRunStartLease(recovered.stepStates)?.attempt).toBe(3);
    expect(startMock).toHaveBeenCalledOnce();
  });

  it("旧启动请求的租约失效后不能初始化同一运行", async () => {
    const currentLease = createRunStartLease();
    const [run] = await db.insert(runs).values({
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      agentId: AGENT_ID,
      versionId: VERSION_ID,
      status: "queued",
      input: {},
      stepStates: withRunStartLease({}, currentLease),
    }).returning({ id: runs.id });

    await expect(initializeRun(run.id, manifest.workflowSnapshot, crypto.randomUUID()))
      .rejects.toThrow("运行启动已由新的请求接管");
    const [unchanged] = await db.select().from(runs).where(eq(runs.id, run.id));
    expect(unchanged.status).toBe("queued");
  });

  it("默认运行只选择助手本工作区的生产版本", async () => {
    const crossManifest = AgentManifest.parse({
      ...manifest,
      workflowFingerprint: "8".repeat(64),
    });
    await db.insert(agentVersions).values({
      id: CROSS_VERSION_ID, agentId: AGENT_ID, workspaceId: OTHER_WS, createdBy: DEMO_USER_ID,
      version: 2, status: "production", manifest: crossManifest,
    });

    const result = await startRunCore({ agentId: AGENT_ID, input: {} });

    expect(result.ok).toBe(true);
    expect(startMock).toHaveBeenCalledWith(expect.any(Function), expect.arrayContaining([
      expect.any(String),
      expect.objectContaining({ workflowFingerprint: "7".repeat(64) }),
    ]));
  });

  it("候选版本只能用于验收，历史生产版本仍可手动重跑", async () => {
    await db.update(agentVersions).set({ status: "candidate" }).where(eq(agentVersions.id, VERSION_ID));

    const manualCandidate = await startRunCore({ agentId: AGENT_ID, versionId: VERSION_ID, input: {}, sourceType: "manual" });
    expect(manualCandidate).toEqual({ ok: false, error: "这个版本不能用于本次运行，请重新选择已发布版本" });
    expect(startMock).not.toHaveBeenCalled();

    const evaluationCandidate = await startRunCore({ agentId: AGENT_ID, versionId: VERSION_ID, input: {}, sourceType: "evaluation" });
    expect(evaluationCandidate.ok).toBe(true);

    await db.update(agentVersions).set({ status: "retired" }).where(eq(agentVersions.id, VERSION_ID));
    const manualRetired = await startRunCore({ agentId: AGENT_ID, versionId: VERSION_ID, input: {}, sourceType: "manual" });
    expect(manualRetired.ok).toBe(true);
  });

  it("验收启动响应丢失时保留待处理样例并在租约过期后补启同一运行", async () => {
    await db.insert(evaluationCases).values({
      id: CASE_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
      agentId: AGENT_ID, name: "启动失败样例", input: {}, expectations: [],
    });
    await db.insert(evaluationRuns).values({
      id: EVALUATION_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
      agentId: AGENT_ID, versionId: VERSION_ID, status: "running", totalCount: 1,
    });
    await db.insert(evaluationCaseResults).values({
      workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
      evaluationRunId: EVALUATION_ID, evaluationCaseId: CASE_ID, status: "running",
    });
    startMock.mockRejectedValueOnce(new Error("模拟工作流启动失败"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sourceKey = `evaluation:${EVALUATION_ID}:${CASE_ID}`;

    const result = await startRunCore({
      agentId: AGENT_ID,
      input: {},
      sourceType: "evaluation",
      sourceKey,
    });

    expect(result).toMatchObject({ ok: true, runId: expect.any(String) });
    const [pending] = await db.select().from(runs).where(eq(runs.sourceKey, sourceKey));
    expect(pending).toMatchObject({ status: "queued", workflowRunId: null, error: null });
    expect(readRunStartLease(pending.stepStates)).not.toBeNull();
    const [caseResult] = await db.select().from(evaluationCaseResults).where(eq(evaluationCaseResults.evaluationRunId, EVALUATION_ID));
    const [evaluation] = await db.select().from(evaluationRuns).where(eq(evaluationRuns.id, EVALUATION_ID));
    expect(caseResult).toMatchObject({ status: "running", error: null });
    expect(evaluation).toMatchObject({ status: "running", failedCount: 0 });
    expect(await startRunCore({ agentId: AGENT_ID, input: {}, sourceType: "evaluation", sourceKey })).toEqual(result);
    expect(startMock).toHaveBeenCalledOnce();

    const staleAt = new Date(Date.now() - RUN_START_LEASE_MS * 2);
    await db.update(runs)
      .set({ stepStates: withRunStartLease(pending.stepStates, createRunStartLease(staleAt)), updatedAt: staleAt })
      .where(eq(runs.id, pending.id));
    await recoverStaleQueuedRuns();
    const [resumed] = await db.select().from(runs).where(eq(runs.id, pending.id));
    expect(resumed).toMatchObject({ status: "queued", workflowRunId: "wrun_test_handle", error: null });
    expect(startMock).toHaveBeenCalledTimes(2);
    log.mockRestore();
  });

  it("启动响应丢失但执行引擎已经开始时保留运行并返回已有标识", async () => {
    startMock.mockImplementationOnce(async (_workflow, [runId, frozenManifest, , context]: [string, AgentManifest, Record<string, unknown>, { startToken: string }]) => {
      await initializeRun(runId, frozenManifest.workflowSnapshot, context.startToken);
      throw new Error("模拟执行引擎已接收但启动响应丢失");
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await startRunCore({ agentId: AGENT_ID, input: {}, sourceKey: "manual:00000000-0000-4000-8000-0000000007d1" });

    expect(result).toMatchObject({ ok: true, runId: expect.any(String) });
    const [run] = await db.select().from(runs).where(eq(runs.id, result.ok ? result.runId : ""));
    expect(run.status).toBe("running");
    expect(run.error).toBeNull();
    expect(await startRunCore({ agentId: AGENT_ID, input: {}, sourceKey: "manual:00000000-0000-4000-8000-0000000007d1" }))
      .toEqual(result);
    expect(startMock).toHaveBeenCalledOnce();
    log.mockRestore();
  });

  it("句柄回写失败时取消失联工作流并把活跃运行置为失败", async () => {
    vi.spyOn(db, "update").mockImplementationOnce(() => { throw new Error("模拟句柄回写失败"); });

    const result = await startRunCore({ agentId: AGENT_ID, input: {} });

    expect(result).toEqual({ ok: false, error: "运行启动失败，请稍后重试" });
    expect(cancelMock).toHaveBeenCalledOnce();
    const [run] = await db.select().from(runs).where(eq(runs.agentId, AGENT_ID));
    expect(run).toMatchObject({ status: "failed", error: "运行启动失败，请稍后重试" });
  });

  it("句柄回写与取消都失败时保留运行，避免已接收的工作流被误判失败", async () => {
    vi.spyOn(db, "update").mockImplementationOnce(() => { throw new Error("模拟句柄回写失败"); });
    cancelMock.mockRejectedValueOnce(new Error("模拟取消响应丢失"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await startRunCore({ agentId: AGENT_ID, input: {} });

    expect(result).toMatchObject({ ok: true, runId: expect.any(String) });
    expect(cancelMock).toHaveBeenCalledOnce();
    const [pending] = await db.select().from(runs).where(eq(runs.id, result.ok ? result.runId : ""));
    expect(pending).toMatchObject({ status: "queued", error: null, workflowRunId: null });
    expect(readRunStartLease(pending.stepStates)).not.toBeNull();
    log.mockRestore();
  });

  it("句柄回写失败后连失败状态也暂时无法保存时保留原运行", async () => {
    vi.spyOn(db, "update")
      .mockImplementationOnce(() => { throw new Error("模拟句柄回写失败"); })
      .mockImplementationOnce(() => { throw new Error("模拟失败状态回写失败"); });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await startRunCore({ agentId: AGENT_ID, input: {} });

    expect(result).toMatchObject({ ok: true, runId: expect.any(String) });
    expect(cancelMock).toHaveBeenCalledOnce();
    const [pending] = await db.select().from(runs).where(eq(runs.id, result.ok ? result.runId : ""));
    expect(pending).toMatchObject({ status: "queued", workflowRunId: null, error: null });
    expect(readRunStartLease(pending.stepStates)).not.toBeNull();
    log.mockRestore();
  });

  it("工作流已先完成时句柄回写失败不会把终态改成失败", async () => {
    const originalUpdate = db.update.bind(db);
    startMock.mockImplementationOnce(async (_workflow, [runId]: [string]) => {
      await originalUpdate(runs)
        .set({ status: "completed", result: { done: true }, finishedAt: new Date() })
        .where(eq(runs.id, runId));
      return { runId: "wrun_test_handle", cancel: cancelMock };
    });
    vi.spyOn(db, "update").mockImplementationOnce(() => { throw new Error("模拟句柄回写失败"); });

    const result = await startRunCore({ agentId: AGENT_ID, input: {} });

    expect(result).toMatchObject({ ok: true, runId: expect.any(String) });
    expect(cancelMock).toHaveBeenCalledOnce();
    const [run] = await db.select().from(runs).where(eq(runs.agentId, AGENT_ID));
    expect(run).toMatchObject({ status: "completed", result: { done: true }, error: null });
    expect(result.ok && result.runId).toBe(run.id);
  });

  it("旧启动租约已被接管时返回原运行标识而不诱发新建", async () => {
    const replacementLease = createRunStartLease();
    startMock.mockImplementationOnce(async (_workflow, [runId]: [string]) => {
      await db.update(runs)
        .set({ stepStates: withRunStartLease({}, replacementLease) })
        .where(eq(runs.id, runId));
      return { runId: "wrun_old_handle", cancel: cancelMock };
    });

    const result = await startRunCore({ agentId: AGENT_ID, input: {}, sourceKey: "manual:00000000-0000-4000-8000-0000000007d2" });

    expect(result).toMatchObject({ ok: true, runId: expect.any(String) });
    expect(cancelMock).toHaveBeenCalledOnce();
    const [run] = await db.select().from(runs).where(eq(runs.id, result.ok ? result.runId : ""));
    expect(run).toMatchObject({ status: "queued", workflowRunId: null, error: null });
    expect(readRunStartLease(run.stepStates)?.token).toBe(replacementLease.token);
    expect(await startRunCore({ agentId: AGENT_ID, input: {}, sourceKey: "manual:00000000-0000-4000-8000-0000000007d2" })).toEqual(result);
    expect(startMock).toHaveBeenCalledOnce();
  });
});
