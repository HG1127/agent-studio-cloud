import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { agentVersions, auditEvents, evaluationCaseResults, evaluationCases, evaluationRuns, runs } from "@/db/schema";
import { db } from "@/lib/db";
import { evaluateExpectations } from "@/server/domain/evaluation";
import { shouldPromoteEvaluation } from "@/server/domain/release-gate";
import { auditEventValues } from "@/server/audit/event-values";

const EvaluationSourceKey = z.string().regex(/^evaluation:[0-9a-f-]{36}:[0-9a-f-]{36}$/i);

export async function reconcileEvaluationSummary(evaluationRunId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [evaluation] = await tx
      .select({
        agentId: evaluationRuns.agentId,
        versionId: evaluationRuns.versionId,
        workspaceId: evaluationRuns.workspaceId,
        createdBy: evaluationRuns.createdBy,
        status: evaluationRuns.status,
      })
      .from(evaluationRuns)
      .where(eq(evaluationRuns.id, evaluationRunId))
      .for("update")
      .limit(1);
    if (!evaluation) return;
    const rows = await tx
      .select({ status: evaluationCaseResults.status })
      .from(evaluationCaseResults)
      .where(and(
        eq(evaluationCaseResults.evaluationRunId, evaluationRunId),
        eq(evaluationCaseResults.workspaceId, evaluation.workspaceId),
      ));
    const passedCount = rows.filter((row) => row.status === "passed").length;
    const failedCount = rows.filter((row) => row.status === "failed").length;
    const complete = rows.length > 0 && passedCount + failedCount === rows.length;
    if (evaluation.status !== "completed" || !complete) {
      await tx
        .update(evaluationRuns)
        .set({
          passedCount,
          failedCount,
          status: complete ? "completed" : "running",
          finishedAt: complete ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(and(eq(evaluationRuns.id, evaluationRunId), eq(evaluationRuns.workspaceId, evaluation.workspaceId)));
    }
    if (complete && evaluation.status !== "completed") {
      await tx.insert(auditEvents).values(auditEventValues({
        workspaceId: evaluation.workspaceId,
        createdBy: evaluation.createdBy,
        action: "evaluation.completed",
        targetType: "evaluation",
        targetId: evaluationRunId,
        summary: `自动验收完成：${passedCount} 条通过，${failedCount} 条未通过`,
        data: { passedCount, failedCount, totalCount: rows.length },
      }));
    }
    if (!complete || !shouldPromoteEvaluation({ totalCount: rows.length, passedCount, failedCount })) return;
    const promoted = await tx
      .update(agentVersions)
      .set({ status: "production", updatedAt: new Date() })
      .where(and(
        eq(agentVersions.id, evaluation.versionId),
        eq(agentVersions.workspaceId, evaluation.workspaceId),
        eq(agentVersions.status, "candidate"),
      ))
      .returning({ id: agentVersions.id, version: agentVersions.version });
    if (promoted.length === 0) return;
    await tx
      .update(agentVersions)
      .set({ status: "retired", updatedAt: new Date() })
      .where(and(
        eq(agentVersions.agentId, evaluation.agentId),
        eq(agentVersions.workspaceId, evaluation.workspaceId),
        eq(agentVersions.status, "production"),
        ne(agentVersions.id, evaluation.versionId),
      ));
    await tx.insert(auditEvents).values(auditEventValues({
      workspaceId: evaluation.workspaceId,
      createdBy: evaluation.createdBy,
      action: "version.promoted",
      targetType: "version",
      targetId: promoted[0].id,
      summary: `自动验收通过，版本 ${promoted[0].version} 已上线`,
      data: { evaluationRunId, version: promoted[0].version },
    }));
  });
}

export async function completeEvaluationForRun(
  runId: string,
  result: Record<string, unknown> | null,
  runError?: string,
): Promise<void> {
  const [run] = await db
    .select({ sourceType: runs.sourceType, sourceKey: runs.sourceKey, workspaceId: runs.workspaceId })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  if (run?.sourceType !== "evaluation" || !run.sourceKey || !EvaluationSourceKey.safeParse(run.sourceKey).success) return;
  const [, evaluationRunId, evaluationCaseId] = run.sourceKey.split(":");
  const [testCase] = await db
    .select({ expectations: evaluationCases.expectations })
    .from(evaluationCases)
    .where(and(eq(evaluationCases.id, evaluationCaseId), eq(evaluationCases.workspaceId, run.workspaceId)))
    .limit(1);
  const outcome = runError
    ? { passed: false, errors: [runError] }
    : testCase && result
      ? evaluateExpectations(result, testCase.expectations)
      : { passed: false, errors: ["验收样例或运行结果不存在"] };
  await db
    .update(evaluationCaseResults)
    .set({ runId, status: outcome.passed ? "passed" : "failed", error: outcome.errors.join("；") || null, updatedAt: new Date() })
    .where(and(
      eq(evaluationCaseResults.evaluationRunId, evaluationRunId),
      eq(evaluationCaseResults.evaluationCaseId, evaluationCaseId),
      eq(evaluationCaseResults.workspaceId, run.workspaceId),
      eq(evaluationCaseResults.status, "running"),
    ));
  // 即使结果已由上一次调用写入，也要重新对账汇总；这样汇总事务的瞬时失败可以被重试修复。
  await reconcileEvaluationSummary(evaluationRunId);
}

export async function reconcileTerminalEvaluationRun(runId: string): Promise<void> {
  const [run] = await db
    .select({ status: runs.status, result: runs.result, error: runs.error })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  if (run?.status === "completed") {
    await completeEvaluationForRun(runId, run.result ?? null);
    return;
  }
  if (run?.status === "failed" || run?.status === "cancelled") {
    const fallback = run.status === "cancelled" ? "验收运行已取消" : "验收运行失败";
    await completeEvaluationForRun(runId, null, run.error ?? fallback);
  }
}

export async function markEvaluationStartFailure(
  evaluationRunId: string,
  evaluationCaseId: string,
  error: string,
  workspaceId: string,
): Promise<void> {
  await db
    .update(evaluationCaseResults)
    .set({ status: "failed", error, updatedAt: new Date() })
    .where(and(
      eq(evaluationCaseResults.evaluationRunId, evaluationRunId),
      eq(evaluationCaseResults.evaluationCaseId, evaluationCaseId),
      eq(evaluationCaseResults.workspaceId, workspaceId),
      eq(evaluationCaseResults.status, "running"),
    ));
  // 与正常完成回调一致：结果写入与汇总之间若曾失败，重复调用仍可修复整轮状态。
  await reconcileEvaluationSummary(evaluationRunId);
}
