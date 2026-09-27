import { and, desc, eq, ilike, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  RunFeedbackView,
  RunImprovementFeedbackView,
  type RunFeedbackView as RunFeedbackViewType,
  type RunImprovementFeedbackView as RunImprovementFeedbackViewType,
} from "@/contracts/run-feedback";
import { agents, evaluationCases, runFeedback } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { escapeLikePattern } from "@/server/domain/search-pattern";
import { redactCredentialText } from "@/server/domain/security/redact-sensitive";
import { parseQueryRows } from "@/server/queries/parse-query-rows";

export async function getRunFeedback(runId: string, workspaceId: string): Promise<RunFeedbackViewType | null> {
  if (!z.string().uuid().safeParse(runId).success || !z.string().uuid().safeParse(workspaceId).success) return null;
  const [row] = await db
    .select({ feedback: runFeedback, activeCaseId: evaluationCases.id })
    .from(runFeedback)
    .leftJoin(evaluationCases, and(
      eq(evaluationCases.id, runFeedback.evaluationCaseId),
      eq(evaluationCases.workspaceId, runFeedback.workspaceId),
      eq(evaluationCases.agentId, runFeedback.agentId),
      isNull(evaluationCases.archivedAt),
    ))
    .where(and(eq(runFeedback.runId, runId), eq(runFeedback.workspaceId, workspaceId)))
    .limit(1);
  if (!row) return null;
  const parsed = RunFeedbackView.safeParse({
    ...row.feedback,
    evaluationCaseId: row.activeCaseId,
    note: row.feedback.note ? redactCredentialText(row.feedback.note) : null,
    updatedAt: row.feedback.updatedAt.toISOString(),
  });
  return parsed.success ? parsed.data : null;
}

export async function listImprovementFeedback(options: {
  agentId?: string;
  query?: string;
  limit?: number;
  offset?: number;
} = {}): Promise<RunImprovementFeedbackViewType[]> {
  const agentId = z.string().uuid().safeParse(options.agentId).data;
  const query = options.query?.trim().slice(0, 200);
  const limit = Math.min(101, Math.max(1, options.limit ?? 20));
  const offset = Math.max(0, options.offset ?? 0);
  const rows = await db
    .select({ feedback: runFeedback, agentName: agents.name, agentArchivedAt: agents.archivedAt, activeCaseId: evaluationCases.id })
    .from(runFeedback)
    .innerJoin(agents, and(eq(agents.id, runFeedback.agentId), eq(agents.workspaceId, runFeedback.workspaceId)))
    .leftJoin(evaluationCases, and(
      eq(evaluationCases.id, runFeedback.evaluationCaseId),
      eq(evaluationCases.workspaceId, runFeedback.workspaceId),
      eq(evaluationCases.agentId, runFeedback.agentId),
      isNull(evaluationCases.archivedAt),
    ))
    .where(and(
      eq(runFeedback.workspaceId, DEMO_WORKSPACE_ID),
      eq(runFeedback.rating, "needs_improvement"),
      agentId ? eq(runFeedback.agentId, agentId) : undefined,
      query ? ilike(runFeedback.note, `%${escapeLikePattern(query)}%`) : undefined,
    ))
    .orderBy(desc(runFeedback.updatedAt))
    .limit(limit)
    .offset(offset);
  return parseQueryRows("待改进运行反馈", RunImprovementFeedbackView, rows.map(({ feedback, agentName, agentArchivedAt, activeCaseId }) => ({
    id: feedback.id,
    runId: feedback.runId,
    agentId: feedback.agentId,
    agentName,
    agentArchived: agentArchivedAt !== null,
    note: feedback.note ? redactCredentialText(feedback.note) : feedback.note,
    evaluationCaseId: activeCaseId,
    updatedAt: feedback.updatedAt.toISOString(),
  })));
}
