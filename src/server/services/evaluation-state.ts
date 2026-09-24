import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { agentVersions, evaluationCaseResults, evaluationCases, evaluationRuns, runs } from "@/db/schema";
import { db } from "@/lib/db";
import { evaluateExpectations } from "@/server/domain/evaluation";
import { shouldPromoteEvaluation } from "@/server/domain/release-gate";

const EvaluationSourceKey = z.string().regex(/^evaluation:[0-9a-f-]{36}:[0-9a-f-]{36}$/i);

async function refreshEvaluationSummary(evaluationRunId: string): Promise<void> {
  const rows = await db
    .select({ status: evaluationCaseResults.status })
    .from(evaluationCaseResults)
    .where(eq(evaluationCaseResults.evaluationRunId, evaluationRunId));
  const passedCount = rows.filter((row) => row.status === "passed").length;
  const failedCount = rows.filter((row) => row.status === "failed").length;
  const complete = rows.length > 0 && passedCount + failedCount === rows.length;
  await db.transaction(async (tx) => {
    await tx
      .update(evaluationRuns)
      .set({
        passedCount,
        failedCount,
        status: complete ? "completed" : "running",
        finishedAt: complete ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(evaluationRuns.id, evaluationRunId));
    if (!complete || !shouldPromoteEvaluation({ totalCount: rows.length, passedCount, failedCount })) return;
    const [evaluation] = await tx
      .select({ agentId: evaluationRuns.agentId, versionId: evaluationRuns.versionId })
      .from(evaluationRuns)
      .where(eq(evaluationRuns.id, evaluationRunId))
      .limit(1);
    if (!evaluation) return;
    const promoted = await tx
      .update(agentVersions)
      .set({ status: "production", updatedAt: new Date() })
      .where(and(eq(agentVersions.id, evaluation.versionId), eq(agentVersions.status, "candidate")))
      .returning({ id: agentVersions.id });
    if (promoted.length === 0) return;
    await tx
      .update(agentVersions)
      .set({ status: "retired", updatedAt: new Date() })
      .where(and(
        eq(agentVersions.agentId, evaluation.agentId),
        eq(agentVersions.status, "production"),
        ne(agentVersions.id, evaluation.versionId),
      ));
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
  const updated = await db
    .update(evaluationCaseResults)
    .set({ runId, status: outcome.passed ? "passed" : "failed", error: outcome.errors.join("；") || null, updatedAt: new Date() })
    .where(and(
      eq(evaluationCaseResults.evaluationRunId, evaluationRunId),
      eq(evaluationCaseResults.evaluationCaseId, evaluationCaseId),
      eq(evaluationCaseResults.status, "running"),
    ))
    .returning({ id: evaluationCaseResults.id });
  if (updated.length === 0) return;
  await refreshEvaluationSummary(evaluationRunId);
}

export async function markEvaluationStartFailure(evaluationRunId: string, evaluationCaseId: string, error: string): Promise<void> {
  const updated = await db
    .update(evaluationCaseResults)
    .set({ status: "failed", error, updatedAt: new Date() })
    .where(and(
      eq(evaluationCaseResults.evaluationRunId, evaluationRunId),
      eq(evaluationCaseResults.evaluationCaseId, evaluationCaseId),
      eq(evaluationCaseResults.status, "running"),
    ))
    .returning({ id: evaluationCaseResults.id });
  if (updated.length === 0) return;
  await refreshEvaluationSummary(evaluationRunId);
}
