import { and, desc, eq, isNull } from "drizzle-orm";
import { EvaluationCaseView, EvaluationRunView, type EvaluationCaseView as EvaluationCaseViewType, type EvaluationRunView as EvaluationRunViewType } from "@/contracts/evaluation";
import { agentVersions, evaluationCases, evaluationRuns } from "@/db/schema";
import { db } from "@/lib/db";

export async function listEvaluationCases(agentId: string, workspaceId: string): Promise<EvaluationCaseViewType[]> {
  const rows = await db
    .select()
    .from(evaluationCases)
    .where(and(eq(evaluationCases.agentId, agentId), eq(evaluationCases.workspaceId, workspaceId), isNull(evaluationCases.archivedAt)))
    .orderBy(desc(evaluationCases.createdAt));
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
  return rows.flatMap(({ evaluation, version }) => {
    const parsed = EvaluationRunView.safeParse({
      ...evaluation,
      version,
      startedAt: evaluation.startedAt.toISOString(),
      finishedAt: evaluation.finishedAt?.toISOString() ?? null,
    });
    return parsed.success ? [parsed.data] : [];
  });
}
