import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { agentVersions, agents, auditEvents, evaluationCaseResults, evaluationCases, evaluationRuns, runFeedback } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { MAX_EVALUATION_CASES } from "@/contracts/evaluation";
import { auditEventValues } from "@/server/audit/event-values";
import { redactCredentialData } from "@/server/domain/security/redact-sensitive";
import { REGRESSION_EXPECTATION_REQUIRED } from "@/server/domain/evaluation";

function safeCases<T extends { input: unknown }>(cases: T[]): Array<Omit<T, "input"> & { input: Record<string, unknown> }> {
  return cases.map((testCase) => ({
    ...testCase,
    input: redactCredentialData(testCase.input) as Record<string, unknown>,
  }));
}

export async function prepareEvaluationRun(agentId: string, requestId?: string) {
  return db.transaction(async (tx) => {
    const [lockedAgent] = await tx
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.workspaceId, DEMO_WORKSPACE_ID), isNull(agents.archivedAt)))
      .for("update")
      .limit(1);
    if (!lockedAgent) return { ok: false as const, error: "找不到这个助手，请刷新页面后重试" };
    const loadEvaluation = async (evaluation: { id: string; agentId: string; versionId: string; status: string }) => {
      if (evaluation.agentId !== agentId) {
        return { ok: false as const, error: "这次验收请求已经用于其他助手，请重新操作" };
      }
      const cases = evaluation.status === "running"
        ? await tx
            .select({ id: evaluationCases.id, input: evaluationCases.input })
            .from(evaluationCaseResults)
            .innerJoin(evaluationCases, eq(evaluationCases.id, evaluationCaseResults.evaluationCaseId))
            .where(and(
              eq(evaluationCaseResults.evaluationRunId, evaluation.id),
              eq(evaluationCaseResults.status, "running"),
              eq(evaluationCaseResults.workspaceId, DEMO_WORKSPACE_ID),
              eq(evaluationCases.workspaceId, DEMO_WORKSPACE_ID),
            ))
            .limit(MAX_EVALUATION_CASES + 1)
        : [];
      if (cases.length > MAX_EVALUATION_CASES) {
        return { ok: false as const, error: `自动验收最多支持 ${MAX_EVALUATION_CASES} 条样例` };
      }
      return {
        ok: true as const,
        evaluationId: evaluation.id,
        versionId: evaluation.versionId,
        cases: safeCases(cases),
        resumed: true as const,
      };
    };
    if (requestId) {
      const [requested] = await tx
        .select({
          id: evaluationRuns.id,
          agentId: evaluationRuns.agentId,
          versionId: evaluationRuns.versionId,
          status: evaluationRuns.status,
        })
        .from(evaluationRuns)
        .where(and(
          eq(evaluationRuns.workspaceId, DEMO_WORKSPACE_ID),
          eq(evaluationRuns.requestId, requestId),
        ))
        .limit(1);
      if (requested) return loadEvaluation(requested);
    }
    const [runningEvaluation] = await tx
      .select({
        id: evaluationRuns.id,
        agentId: evaluationRuns.agentId,
        versionId: evaluationRuns.versionId,
        status: evaluationRuns.status,
        requestId: evaluationRuns.requestId,
      })
      .from(evaluationRuns)
      .where(and(
        eq(evaluationRuns.agentId, agentId),
        eq(evaluationRuns.workspaceId, DEMO_WORKSPACE_ID),
        eq(evaluationRuns.status, "running"),
      ))
      .limit(1);
    if (runningEvaluation) {
      if (requestId && runningEvaluation.requestId && runningEvaluation.requestId !== requestId) {
        return { ok: false as const, error: "已有一轮自动验收正在运行，请刷新页面后点检查并继续" };
      }
      return loadEvaluation(runningEvaluation);
    }
    const [version] = await tx
      .select({ id: agentVersions.id })
      .from(agentVersions)
      .innerJoin(agents, eq(agents.id, agentVersions.agentId))
      .where(and(
        eq(agentVersions.agentId, agentId),
        eq(agentVersions.workspaceId, DEMO_WORKSPACE_ID),
        eq(agents.workspaceId, DEMO_WORKSPACE_ID),
        inArray(agentVersions.status, ["candidate", "production"]),
        isNull(agents.archivedAt),
      ))
      .orderBy(desc(agentVersions.version))
      .limit(1);
    if (!version) return { ok: false as const, error: "请先发布一个待验收版本" };
    const cases = await tx
      .select({ id: evaluationCases.id, input: evaluationCases.input, expectations: evaluationCases.expectations })
      .from(evaluationCases)
      .where(and(
        eq(evaluationCases.agentId, agentId),
        eq(evaluationCases.workspaceId, DEMO_WORKSPACE_ID),
        isNull(evaluationCases.archivedAt),
      ))
      .limit(MAX_EVALUATION_CASES + 1);
    if (cases.length === 0) return { ok: false as const, error: "请先添加至少一条验收样例" };
    if (cases.length > MAX_EVALUATION_CASES) return { ok: false as const, error: `自动验收最多支持 ${MAX_EVALUATION_CASES} 条样例` };
    const emptyCaseIds = cases.filter((testCase) => testCase.expectations.length === 0).map((testCase) => testCase.id);
    if (emptyCaseIds.length > 0) {
      const [linkedFeedback] = await tx.select({ id: runFeedback.id }).from(runFeedback).where(and(
        eq(runFeedback.workspaceId, DEMO_WORKSPACE_ID),
        eq(runFeedback.agentId, agentId),
        inArray(runFeedback.evaluationCaseId, emptyCaseIds),
      )).limit(1);
      if (linkedFeedback) return { ok: false as const, error: REGRESSION_EXPECTATION_REQUIRED };
    }
    const [evaluation] = await tx.insert(evaluationRuns).values({
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      agentId,
      versionId: version.id,
      requestId,
      status: "running",
      totalCount: cases.length,
    }).returning({ id: evaluationRuns.id });
    await tx.insert(evaluationCaseResults).values(cases.map((testCase) => ({
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      evaluationRunId: evaluation.id,
      evaluationCaseId: testCase.id,
      status: "running",
    })));
    await tx.insert(auditEvents).values(auditEventValues({
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      action: "evaluation.started",
      targetType: "evaluation",
      targetId: evaluation.id,
      summary: `启动助手「${lockedAgent.name}」的自动验收`,
      data: { caseCount: cases.length },
    }));
    return { ok: true as const, evaluationId: evaluation.id, versionId: version.id, cases: safeCases(cases), resumed: false as const };
  });
}
