import { and, desc, eq, ilike } from "drizzle-orm";
import { z } from "zod";
import {
  RunFeedbackView,
  RunImprovementFeedbackView,
  type RunFeedbackView as RunFeedbackViewType,
  type RunImprovementFeedbackView as RunImprovementFeedbackViewType,
} from "@/contracts/run-feedback";
import { agents, runFeedback } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { escapeLikePattern } from "@/server/domain/search-pattern";
import { parseQueryRows } from "@/server/queries/parse-query-rows";

export async function getRunFeedback(runId: string, workspaceId: string): Promise<RunFeedbackViewType | null> {
  if (!z.string().uuid().safeParse(runId).success || !z.string().uuid().safeParse(workspaceId).success) return null;
  const [row] = await db
    .select()
    .from(runFeedback)
    .where(and(eq(runFeedback.runId, runId), eq(runFeedback.workspaceId, workspaceId)))
    .limit(1);
  if (!row) return null;
  const parsed = RunFeedbackView.safeParse({ ...row, updatedAt: row.updatedAt.toISOString() });
  return parsed.success ? parsed.data : null;
}

export async function listImprovementFeedback(options: {
  agentId?: string;
  query?: string;
  limit?: number;
} = {}): Promise<RunImprovementFeedbackViewType[]> {
  const agentId = z.string().uuid().safeParse(options.agentId).data;
  const query = options.query?.trim().slice(0, 200);
  const limit = Math.min(100, Math.max(1, options.limit ?? 20));
  const rows = await db
    .select({ feedback: runFeedback, agentName: agents.name, agentArchivedAt: agents.archivedAt })
    .from(runFeedback)
    .innerJoin(agents, and(eq(agents.id, runFeedback.agentId), eq(agents.workspaceId, runFeedback.workspaceId)))
    .where(and(
      eq(runFeedback.workspaceId, DEMO_WORKSPACE_ID),
      eq(runFeedback.rating, "needs_improvement"),
      agentId ? eq(runFeedback.agentId, agentId) : undefined,
      query ? ilike(runFeedback.note, `%${escapeLikePattern(query)}%`) : undefined,
    ))
    .orderBy(desc(runFeedback.updatedAt))
    .limit(limit);
  return parseQueryRows("待改进运行反馈", RunImprovementFeedbackView, rows.map(({ feedback, agentName, agentArchivedAt }) => ({
    id: feedback.id,
    runId: feedback.runId,
    agentId: feedback.agentId,
    agentName,
    agentArchived: agentArchivedAt !== null,
    note: feedback.note,
    evaluationCaseId: feedback.evaluationCaseId,
    updatedAt: feedback.updatedAt.toISOString(),
  })));
}
