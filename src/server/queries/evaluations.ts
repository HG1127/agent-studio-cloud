import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { EvaluationCaseView, EvaluationRunView, type EvaluationCaseView as EvaluationCaseViewType, type EvaluationRunView as EvaluationRunViewType } from "@/contracts/evaluation";
import { agentVersions, evaluationCaseResults, evaluationCases, evaluationRuns } from "@/db/schema";
import { db } from "@/lib/db";
import { parseQueryRows } from "@/server/queries/parse-query-rows";
import { redactCredentialData, redactCredentialText } from "@/server/domain/security/redact-sensitive";

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
    .orderBy(desc(evaluationCases.createdAt), desc(evaluationCases.id))
    .limit(limit)
    .offset(offset);
  return parseQueryRows("验收样例列表", EvaluationCaseView, rows.map((row) => ({
    ...row,
    input: redactCredentialData(row.input),
    expectations: redactCredentialData(row.expectations),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  })));
}

export async function listEvaluationRuns(
  agentId: string,
  workspaceId: string,
  pagination: { limit?: number; offset?: number } = {},
): Promise<EvaluationRunViewType[]> {
  const limit = Math.min(51, Math.max(1, pagination.limit ?? 10));
  const offset = Math.max(0, pagination.offset ?? 0);
  const rows = await db
    .select({ evaluation: evaluationRuns, version: agentVersions.version })
    .from(evaluationRuns)
    .innerJoin(agentVersions, eq(agentVersions.id, evaluationRuns.versionId))
    .where(and(
      eq(evaluationRuns.agentId, agentId),
      eq(evaluationRuns.workspaceId, workspaceId),
      eq(agentVersions.agentId, agentId),
      eq(agentVersions.workspaceId, workspaceId),
    ))
    .orderBy(desc(evaluationRuns.createdAt), desc(evaluationRuns.id))
    .limit(limit)
    .offset(offset);
  if (rows.length === 0) return [];
  const resultRows = await db
    .select({ result: evaluationCaseResults, caseName: evaluationCases.name })
    .from(evaluationCaseResults)
    .innerJoin(evaluationCases, eq(evaluationCases.id, evaluationCaseResults.evaluationCaseId))
    .where(and(
      inArray(evaluationCaseResults.evaluationRunId, rows.map(({ evaluation }) => evaluation.id)),
      eq(evaluationCaseResults.workspaceId, workspaceId),
      eq(evaluationCases.workspaceId, workspaceId),
    ));
  const resultsByRun = new Map<string, typeof resultRows>();
  for (const result of resultRows) {
    const values = resultsByRun.get(result.result.evaluationRunId) ?? [];
    values.push(result);
    resultsByRun.set(result.result.evaluationRunId, values);
  }
  return parseQueryRows("自动验收记录", EvaluationRunView, rows.map(({ evaluation, version }) => ({
    ...evaluation,
    version,
    startedAt: evaluation.startedAt.toISOString(),
    finishedAt: evaluation.finishedAt?.toISOString() ?? null,
    results: (resultsByRun.get(evaluation.id) ?? []).map(({ result, caseName }) => ({
      caseId: result.evaluationCaseId,
      caseName,
      status: result.status,
      error: result.error === null ? null : redactCredentialText(result.error),
      runId: result.runId,
    })),
  })));
}

export async function hasRunningEvaluation(agentId: string, workspaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: evaluationRuns.id })
    .from(evaluationRuns)
    .where(and(
      eq(evaluationRuns.agentId, agentId),
      eq(evaluationRuns.workspaceId, workspaceId),
      eq(evaluationRuns.status, "running"),
    ))
    .limit(1);
  return Boolean(row);
}
