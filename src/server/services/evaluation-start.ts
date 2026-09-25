import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { agentVersions, agents, auditEvents, evaluationCaseResults, evaluationCases, evaluationRuns } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { MAX_EVALUATION_CASES } from "@/contracts/evaluation";
import { auditEventValues } from "@/server/audit/event-values";

export async function prepareEvaluationRun(agentId: string) {
  return db.transaction(async (tx) => {
    const [lockedAgent] = await tx
      .select({ id: agents.id, name: agents.name })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.workspaceId, DEMO_WORKSPACE_ID), isNull(agents.archivedAt)))
      .for("update")
      .limit(1);
    if (!lockedAgent) return { ok: false as const, error: "找不到这个助手，请刷新页面后重试" };
    const [runningEvaluation] = await tx
      .select({ id: evaluationRuns.id })
      .from(evaluationRuns)
      .where(and(
        eq(evaluationRuns.agentId, agentId),
        eq(evaluationRuns.workspaceId, DEMO_WORKSPACE_ID),
        eq(evaluationRuns.status, "running"),
      ))
      .limit(1);
    if (runningEvaluation) {
      const [evaluation] = await tx
        .select({ versionId: evaluationRuns.versionId })
        .from(evaluationRuns)
        .where(and(
          eq(evaluationRuns.id, runningEvaluation.id),
          eq(evaluationRuns.workspaceId, DEMO_WORKSPACE_ID),
        ))
        .limit(1);
      const cases = await tx
        .select({ id: evaluationCases.id, input: evaluationCases.input })
        .from(evaluationCaseResults)
        .innerJoin(evaluationCases, eq(evaluationCases.id, evaluationCaseResults.evaluationCaseId))
        .where(and(
          eq(evaluationCaseResults.evaluationRunId, runningEvaluation.id),
          eq(evaluationCaseResults.status, "running"),
          eq(evaluationCaseResults.workspaceId, DEMO_WORKSPACE_ID),
          eq(evaluationCases.workspaceId, DEMO_WORKSPACE_ID),
        ))
        .limit(MAX_EVALUATION_CASES + 1);
      if (!evaluation) return { ok: false as const, error: "自动验收记录不完整，请稍后重试" };
      if (cases.length > MAX_EVALUATION_CASES) return { ok: false as const, error: `自动验收最多支持 ${MAX_EVALUATION_CASES} 条样例` };
      return {
        ok: true as const,
        evaluationId: runningEvaluation.id,
        versionId: evaluation.versionId,
        cases,
        resumed: true as const,
      };
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
      .select({ id: evaluationCases.id, input: evaluationCases.input })
      .from(evaluationCases)
      .where(and(
        eq(evaluationCases.agentId, agentId),
        eq(evaluationCases.workspaceId, DEMO_WORKSPACE_ID),
        isNull(evaluationCases.archivedAt),
      ))
      .limit(MAX_EVALUATION_CASES + 1);
    if (cases.length === 0) return { ok: false as const, error: "请先添加至少一条验收样例" };
    if (cases.length > MAX_EVALUATION_CASES) return { ok: false as const, error: `自动验收最多支持 ${MAX_EVALUATION_CASES} 条样例` };
    const [evaluation] = await tx.insert(evaluationRuns).values({
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      agentId,
      versionId: version.id,
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
    return { ok: true as const, evaluationId: evaluation.id, versionId: version.id, cases, resumed: false as const };
  });
}
