import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { EvaluationCaseView, EvaluationRunView, type EvaluationCaseView as EvaluationCaseViewType, type EvaluationRunView as EvaluationRunViewType } from "@/contracts/evaluation";
import { agentVersions, evaluationCaseResults, evaluationCases, evaluationRuns } from "@/db/schema";
import { db } from "@/lib/db";

export async function listEvaluationCases(
  agentId: string,
  workspaceId: string,
  options: { archived?: boolean; limit?: number; offset?: number } = {},
): Promise<EvaluationCaseViewType[]> {
  const archived = options.archived ?? false;
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 101);
  const offset = Math.max(options.offset ?? 0, 0);
  const rows = await db
    .select()
    .from(evaluationCases)
    .where(and(
      eq(evaluationCases.agentId, agentId),
      eq(evaluationCases.workspaceId, workspaceId),
      archived ? isNotNull(evaluationCases.archivedAt) : isNull(evaluationCases.archivedAt),
    ))
    .orderBy(desc(evaluationCases.createdAt))
    .limit(limit)
    .offset(offset);
  return rows.flatMap((row) => {
    const parsed = EvaluationCaseView.safeParse({ ...row, createdAt: row.createdAt.toISOString() });
    return parsed.success ? [parsed.data] : [];
  });
}

export async function listEvaluationRuns(agentId: string, workspaceId: string): Promise<EvaluationRunViewType[]> {
  const rows = await db
    .select({ evaluation: evaluationRuns, version: agentVersions.version })
    .from(evaluationRuns)
    .innerJoin(agentVersions, eq(agentVersions.id, evaluationRuns.versionId))
    .where(and(eq(evaluationRuns.agentId, agentId), eq(evaluationRuns.workspaceId, workspaceId)))
    .orderBy(desc(evaluationRuns.createdAt))
    .limit(10);
  if (rows.length === 0) return [];
  const resultRows = await db
    .select({ result: evaluationCaseResults, caseName: evaluationCases.name })
    .from(evaluationCaseResults)
    .innerJoin(evaluationCases, eq(evaluationCases.id, evaluationCaseResults.evaluationCaseId))
    .where(and(
      inArray(evaluationCaseResults.evaluationRunId, rows.map(({ evaluation }) => evaluation.id)),
      eq(evaluationCaseResults.workspaceId, workspaceId),
    ));
  const resultsByRun = new Map<string, typeof resultRows>();
  for (const result of resultRows) {
    const values = resultsByRun.get(result.result.evaluationRunId) ?? [];
    values.push(result);
    resultsByRun.set(result.result.evaluationRunId, values);
  }
  return rows.flatMap(({ evaluation, version }) => {
    const parsed = EvaluationRunView.safeParse({
      ...evaluation,
      version,
      startedAt: evaluation.startedAt.toISOString(),
      finishedAt: evaluation.finishedAt?.toISOString() ?? null,
      results: (resultsByRun.get(evaluation.id) ?? []).map(({ result, caseName }) => ({
        caseId: result.evaluationCaseId,
        caseName,
        status: result.status,
        error: result.error,
        runId: result.runId,
      })),
    });
    return parsed.success ? [parsed.data] : [];
  });
}
