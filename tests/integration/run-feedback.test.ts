import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentManifest } from "@/contracts/manifest";
import { MAX_EVALUATION_CASES } from "@/contracts/evaluation";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { agents, agentVersions, auditEvents, evaluationCases, evaluationRuns, runFeedback, runs } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { createRegressionCaseFromRunFeedbackAction, saveRunFeedbackAction } from "@/server/actions/run-feedback";
import { getRunFeedback, listImprovementFeedback } from "@/server/queries/run-feedback";
import { listMemoryAgentOptions } from "@/server/queries/memory";

const AGENT_ID = "00000000-0000-4000-8000-0000000000f1";
const VERSION_ID = "00000000-0000-4000-8000-0000000000f2";
const RUN_ID = "00000000-0000-4000-8000-0000000000f3";

const manifest = AgentManifest.parse({
  schemaVersion: "4.0",
  workflowFingerprint: "run-feedback",
  workflowSnapshot: {
    id: "workflow", versionId: null, startNodeId: "start",
    rootAgent: { id: AGENT_ID, name: "反馈助手", role: "业务助手" },
    nodes: {
      start: { id: "start", title: "开始", type: "trigger", next: "end", requirementIds: [], businessSpec: null },
      end: { id: "end", title: "结束", type: "end", next: null, requirementIds: [], businessSpec: null },
    },
    variables: [], memoryPolicy: { taskContext: true, longTerm: false }, outputContract: { fields: [] }, ui: { positions: {} },
  },
  inputContract: { fields: [] }, outputContract: { fields: [] },
  resourceSelection: { model: { modelId: "mock", mock: true, connectionId: null } },
  designAudit: { status: "passed", issueCount: 0, criticalCount: 0 }, knowledgeSnapshot: [],
});

afterEach(async () => {
  await db.delete(auditEvents).where(eq(auditEvents.targetId, RUN_ID));
  await db.delete(runFeedback).where(eq(runFeedback.runId, RUN_ID));
  await db.delete(evaluationRuns).where(eq(evaluationRuns.agentId, AGENT_ID));
  const caseRows = await db.select({ id: evaluationCases.id }).from(evaluationCases).where(eq(evaluationCases.agentId, AGENT_ID));
  if (caseRows.length > 0) await db.delete(auditEvents).where(inArray(auditEvents.targetId, caseRows.map((row) => row.id)));
  await db.delete(evaluationCases).where(eq(evaluationCases.agentId, AGENT_ID));
  await db.delete(runs).where(eq(runs.id, RUN_ID));
  await db.delete(agentVersions).where(eq(agentVersions.id, VERSION_ID));
  await db.delete(agents).where(eq(agents.id, AGENT_ID));
});

async function insertFixture(status = "completed") {
  await db.insert(agents).values({
    id: AGENT_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
    name: "反馈助手", intentText: "收集运行反馈并形成可重复执行的改进验收样例",
  });
  await db.insert(agentVersions).values({
    id: VERSION_ID, agentId: AGENT_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
    version: 1, status: "production", manifest,
  });
  await db.insert(runs).values({
    id: RUN_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
    agentId: AGENT_ID, versionId: VERSION_ID, status, input: { request: "检查合同" }, result: { answer: "完成" },
  });
}

describe("运行反馈闭环", () => {
  it("响应丢失后重复保存相同反馈时复用已有记录", async () => {
    await insertFixture();
    const savedAt = new Date("2026-09-26T00:00:00.000Z");
    await db.insert(runFeedback).values({
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      runId: RUN_ID,
      agentId: AGENT_ID,
      rating: "needs_improvement",
      note: "缺少条款依据",
      updatedAt: savedAt,
    });

    const result = await saveRunFeedbackAction({
      runId: RUN_ID,
      rating: "needs_improvement",
      note: "缺少条款依据",
    });

    expect(result).toMatchObject({ ok: true, feedback: { updatedAt: savedAt.toISOString() } });
    const rows = await db.select().from(runFeedback).where(eq(runFeedback.runId, RUN_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0].updatedAt).toEqual(savedAt);
  });

  it("同一次运行更新反馈时只保留一条记录", async () => {
    await insertFixture();
    expect((await saveRunFeedbackAction({ runId: RUN_ID, rating: "useful" })).ok).toBe(true);
    expect((await saveRunFeedbackAction({ runId: RUN_ID, rating: "needs_improvement", note: "缺少条款依据" })).ok).toBe(true);

    const rows = await db.select().from(runFeedback).where(eq(runFeedback.runId, RUN_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rating: "needs_improvement", note: "缺少条款依据" });
    expect(await listImprovementFeedback({ agentId: AGENT_ID, query: "条款" })).toEqual([
      expect.objectContaining({ runId: RUN_ID, agentName: "反馈助手", agentArchived: false, note: "缺少条款依据" }),
    ]);
    expect(await listMemoryAgentOptions()).toContainEqual({ id: AGENT_ID, name: "反馈助手" });
  });

  it("差评只创建一个可编辑回归样例并复制真实输入", async () => {
    await insertFixture();
    await db.update(runs).set({ input: { request: "检查合同", apiKey: "sk-feedback-secret-value" } }).where(eq(runs.id, RUN_ID));
    await saveRunFeedbackAction({ runId: RUN_ID, rating: "needs_improvement", note: "缺少条款依据" });

    const first = await createRegressionCaseFromRunFeedbackAction(RUN_ID);
    const second = await createRegressionCaseFromRunFeedbackAction(RUN_ID);

    expect(first).toMatchObject({ ok: true, created: true });
    expect(second).toMatchObject({ ok: true, created: false });
    const cases = await db.select().from(evaluationCases).where(eq(evaluationCases.agentId, AGENT_ID));
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      input: { request: "检查合同", apiKey: "[已隐藏敏感信息]" },
      expectations: [],
    });
  });

  it("归档关联样例后显示可重新加入，并恢复同一历史样例", async () => {
    await insertFixture();
    await saveRunFeedbackAction({ runId: RUN_ID, rating: "needs_improvement", note: "需要回归检查" });
    const first = await createRegressionCaseFromRunFeedbackAction(RUN_ID);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await db.update(evaluationCases).set({ archivedAt: new Date() }).where(eq(evaluationCases.id, first.evaluationCaseId));

    expect(await getRunFeedback(RUN_ID, DEMO_WORKSPACE_ID)).toMatchObject({ evaluationCaseId: null });
    expect(await listImprovementFeedback({ agentId: AGENT_ID })).toEqual([
      expect.objectContaining({ runId: RUN_ID, evaluationCaseId: null }),
    ]);
    expect(await saveRunFeedbackAction({ runId: RUN_ID, rating: "needs_improvement", note: "需要回归检查" }))
      .toMatchObject({ ok: true, feedback: { evaluationCaseId: null } });

    await db.insert(evaluationRuns).values({
      workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, agentId: AGENT_ID,
      versionId: VERSION_ID, status: "running", totalCount: 1,
    });
    expect(await createRegressionCaseFromRunFeedbackAction(RUN_ID)).toEqual({
      ok: false, error: "自动验收运行期间不能新增回归样例，请等待验收完成",
    });
    await db.delete(evaluationRuns).where(eq(evaluationRuns.agentId, AGENT_ID));

    expect(await createRegressionCaseFromRunFeedbackAction(RUN_ID)).toEqual({
      ok: true, evaluationCaseId: first.evaluationCaseId, created: true,
    });
    expect(await createRegressionCaseFromRunFeedbackAction(RUN_ID)).toEqual({
      ok: true, evaluationCaseId: first.evaluationCaseId, created: false,
    });
    const cases = await db.select().from(evaluationCases).where(eq(evaluationCases.agentId, AGENT_ID));
    expect(cases).toHaveLength(1);
    expect(cases[0].archivedAt).toBeNull();
    expect(await getRunFeedback(RUN_ID, DEMO_WORKSPACE_ID)).toMatchObject({ evaluationCaseId: first.evaluationCaseId });
  });

  it("关联样例已归档且启用数量达到上限时不偷偷恢复", async () => {
    await insertFixture();
    await saveRunFeedbackAction({ runId: RUN_ID, rating: "needs_improvement", note: "需要回归检查" });
    const first = await createRegressionCaseFromRunFeedbackAction(RUN_ID);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await db.update(evaluationCases).set({ archivedAt: new Date() }).where(eq(evaluationCases.id, first.evaluationCaseId));
    await db.insert(evaluationCases).values(Array.from({ length: MAX_EVALUATION_CASES }, (_, index) => ({
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      agentId: AGENT_ID,
      name: `其他验收样例 ${index + 1}`,
      input: {},
      expectations: [],
    })));

    expect(await createRegressionCaseFromRunFeedbackAction(RUN_ID)).toEqual({
      ok: false, error: `启用中的验收样例已达到 ${MAX_EVALUATION_CASES} 条上限`,
    });
    const [linked] = await db.select({ archivedAt: evaluationCases.archivedAt })
      .from(evaluationCases).where(eq(evaluationCases.id, first.evaluationCaseId));
    expect(linked.archivedAt).not.toBeNull();
  });

  it("自动验收运行期间不能从差评新增未参与本轮的回归样例", async () => {
    await insertFixture();
    await saveRunFeedbackAction({ runId: RUN_ID, rating: "needs_improvement", note: "需要加入回归" });
    await db.insert(evaluationRuns).values({
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      agentId: AGENT_ID,
      versionId: VERSION_ID,
      status: "running",
      totalCount: 1,
    });

    const result = await createRegressionCaseFromRunFeedbackAction(RUN_ID);

    expect(result).toEqual({
      ok: false,
      error: "自动验收运行期间不能新增回归样例，请等待验收完成",
    });
    expect(await db.select().from(evaluationCases).where(eq(evaluationCases.agentId, AGENT_ID))).toHaveLength(0);
  });

  it("写入和读取反馈时隐藏误贴的服务凭据", async () => {
    await insertFixture();
    const result = await saveRunFeedbackAction({
      runId: RUN_ID,
      rating: "needs_improvement",
      note: "缺少依据，authorization: Bearer private-feedback-token",
    });

    expect(result).toMatchObject({
      ok: true,
      feedback: { note: "缺少依据，[已隐藏敏感信息]" },
    });
    const [stored] = await db.select({ note: runFeedback.note }).from(runFeedback).where(eq(runFeedback.runId, RUN_ID));
    expect(stored?.note).toBe("缺少依据，[已隐藏敏感信息]");

    await db.update(runFeedback)
      .set({ note: "历史反馈 secret=legacy-private-value" })
      .where(eq(runFeedback.runId, RUN_ID));
    expect(await listImprovementFeedback({ agentId: AGENT_ID })).toEqual([
      expect.objectContaining({ note: "历史反馈 [已隐藏敏感信息]" }),
    ]);
    expect(await getRunFeedback(RUN_ID, DEMO_WORKSPACE_ID)).toEqual(
      expect.objectContaining({ note: "历史反馈 [已隐藏敏感信息]" }),
    );
  });

  it("运行未完成时拒绝提交结果反馈", async () => {
    await insertFixture("running");
    expect(await saveRunFeedbackAction({ runId: RUN_ID, rating: "useful" })).toEqual({
      ok: false, error: "运行完成后才能评价结果",
    });
  });
});
