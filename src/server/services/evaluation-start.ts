import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { agentVersions, agents, auditEvents, evaluationCaseResults, evaluationCases, evaluationRuns, runFeedback } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { EvaluationCaseSnapshot, MAX_EVALUATION_CASES } from "@/contracts/evaluation";
import { auditEventValues } from "@/server/audit/event-values";
import { redactCredentialData } from "@/server/domain/security/redact-sensitive";
import { REGRESSION_EXPECTATION_REQUIRED } from "@/server/domain/evaluation";
import { evaluationResultSchemaIssue } from "@/server/domain/evaluation-result-schema";

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
            .select({ id: evaluationCases.id, input: evaluationCases.input, caseSnapshot: evaluationCaseResults.caseSnapshot })
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
      if (cases.some((testCase) => testCase.caseSnapshot != null
        && evaluationResultSchemaIssue(EvaluationCaseSnapshot.parse(testCase.caseSnapshot).resultSchema))) {
        return { ok: false as const, error: "验收结果字段规则快照无效，请重新验收" };
      }
      return {
        ok: true as const,
        evaluationId: evaluation.id,
        versionId: evaluation.versionId,
        cases: safeCases(cases.map(({ id, input, caseSnapshot }) => ({
          id,
          input: caseSnapshot == null ? input : EvaluationCaseSnapshot.parse(caseSnapshot).input,
        }))),
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
      .select({ id: evaluationCases.id, name: evaluationCases.name, input: evaluationCases.input, expectations: evaluationCases.expectations, resultSchema: evaluationCases.resultSchema })
      .from(evaluationCases)
      .where(and(
        eq(evaluationCases.agentId, agentId),
        eq(evaluationCases.workspaceId, DEMO_WORKSPACE_ID),
        isNull(evaluationCases.archivedAt),
      ))
      .limit(MAX_EVALUATION_CASES + 1);
    if (cases.length === 0) return { ok: false as const, error: "请先添加至少一条验收样例" };
    if (cases.length > MAX_EVALUATION_CASES) return { ok: false as const, error: `自动验收最多支持 ${MAX_EVALUATION_CASES} 条样例` };
    const schemaIssue = cases.map((testCase) => evaluationResultSchemaIssue(testCase.resultSchema)).find(Boolean);
    if (schemaIssue) return { ok: false as const, error: schemaIssue };
    const emptyCaseIds = cases.filter((testCase) => testCase.expectations.length === 0 && !testCase.resultSchema).map((testCase) => testCase.id);
    if (emptyCaseIds.length > 0) {
      const [linkedFeedback] = await tx.select({ id: runFeedback.id }).from(runFeedback).where(and(
        eq(runFeedback.workspaceId, DEMO_WORKSPACE_ID),
        eq(runFeedback.agentId, agentId),
        inArray(runFeedback.evaluationCaseId, emptyCaseIds),
      )).limit(1);
      if (linkedFeedback) return { ok: false as const, error: REGRESSION_EXPECTATION_REQUIRED };
    }
    const snapshots = cases.map((testCase) => EvaluationCaseSnapshot.safeParse({
      name: testCase.name, input: testCase.input, expectations: testCase.expectations,
      ...(testCase.resultSchema == null ? {} : { resultSchema: testCase.resultSchema }),
    }));
    if (snapshots.some((snapshot) => !snapshot.success)) {
      return { ok: false as const, error: "验收样例数据不完整，请编辑样例后重试" };
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
    await tx.insert(evaluationCaseResults).values(cases.map((testCase, index) => ({
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      evaluationRunId: evaluation.id,
      evaluationCaseId: testCase.id,
      caseSnapshot: snapshots[index].data!,
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
