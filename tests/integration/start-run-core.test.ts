import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { startMock, cancelMock } = vi.hoisted(() => ({ startMock: vi.fn(), cancelMock: vi.fn() }));
vi.mock("workflow/api", () => ({ start: startMock }));

import { AgentManifest } from "@/contracts/manifest";
import { agents, agentVersions, evaluationCaseResults, evaluationCases, evaluationRuns, runs } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { startRunCore } from "@/server/services/start-run-core";

const AGENT_ID = "00000000-0000-4000-8000-0000000007a1";
const VERSION_ID = "00000000-0000-4000-8000-0000000007a2";
const EVALUATION_ID = "00000000-0000-4000-8000-0000000007a3";
const CASE_ID = "00000000-0000-4000-8000-0000000007a4";
const CROSS_VERSION_ID = "00000000-0000-4000-8000-0000000007a5";
const OTHER_WS = "00000000-0000-4000-8000-0000000007af";
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
  await db.delete(runs).where(eq(runs.agentId, AGENT_ID));
  await db.delete(evaluationCaseResults).where(eq(evaluationCaseResults.evaluationRunId, EVALUATION_ID));
  await db.delete(evaluationRuns).where(eq(evaluationRuns.id, EVALUATION_ID));
  await db.delete(evaluationCases).where(eq(evaluationCases.id, CASE_ID));
  await db.delete(agentVersions).where(inArray(agentVersions.id, [VERSION_ID, CROSS_VERSION_ID]));
  await db.delete(agents).where(eq(agents.id, AGENT_ID));
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
  it("相同来源键重试时复用已有运行且不重复启动工作流", async () => {
    const first = await startRunCore({ agentId: AGENT_ID, input: {}, sourceType: "evaluation", sourceKey: "evaluation:00000000-0000-4000-8000-000000000701:00000000-0000-4000-8000-000000000702" });
    const second = await startRunCore({ agentId: AGENT_ID, input: {}, sourceType: "evaluation", sourceKey: "evaluation:00000000-0000-4000-8000-000000000701:00000000-0000-4000-8000-000000000702" });

    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    expect(startMock).toHaveBeenCalledOnce();
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

  it("验收运行启动失败时直接落定样例与验收汇总", async () => {
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

    const result = await startRunCore({
      agentId: AGENT_ID,
      input: {},
      sourceType: "evaluation",
      sourceKey: `evaluation:${EVALUATION_ID}:${CASE_ID}`,
    });

    expect(result).toEqual({ ok: false, error: "运行启动失败，请稍后重试" });
    const [caseResult] = await db.select().from(evaluationCaseResults).where(eq(evaluationCaseResults.evaluationRunId, EVALUATION_ID));
    const [evaluation] = await db.select().from(evaluationRuns).where(eq(evaluationRuns.id, EVALUATION_ID));
    expect(caseResult).toMatchObject({ status: "failed", error: "运行启动失败，请稍后重试" });
    expect(evaluation).toMatchObject({ status: "completed", failedCount: 1 });
  });

  it("句柄回写失败时取消失联工作流并把活跃运行置为失败", async () => {
    vi.spyOn(db, "update").mockImplementationOnce(() => { throw new Error("模拟句柄回写失败"); });

    const result = await startRunCore({ agentId: AGENT_ID, input: {} });

    expect(result).toEqual({ ok: false, error: "运行启动失败，请稍后重试" });
    expect(cancelMock).toHaveBeenCalledOnce();
    const [run] = await db.select().from(runs).where(eq(runs.agentId, AGENT_ID));
    expect(run).toMatchObject({ status: "failed", error: "运行启动失败，请稍后重试" });
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

    expect(result).toEqual({ ok: false, error: "运行启动失败，请稍后重试" });
    expect(cancelMock).toHaveBeenCalledOnce();
    const [run] = await db.select().from(runs).where(eq(runs.agentId, AGENT_ID));
    expect(run).toMatchObject({ status: "completed", result: { done: true }, error: null });
  });
});
