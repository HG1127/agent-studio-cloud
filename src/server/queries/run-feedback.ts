import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { RunFeedbackView, type RunFeedbackView as RunFeedbackViewType } from "@/contracts/run-feedback";
import { runFeedback } from "@/db/schema";
import { db } from "@/lib/db";

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
