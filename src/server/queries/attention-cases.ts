import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { AttentionCaseListInput, AttentionCaseListResult, AttentionCaseView, AttentionHandlingHistory } from "@/contracts/attention-handling";
import { AttentionReference } from "@/contracts/attention-reference";
import { attentionCases } from "@/db/schema";
import { db } from "@/lib/db";
import { attentionSourceState } from "@/server/domain/attention-handling";
import { redactAttentionText } from "@/server/domain/attention";
import { findCurrentAttention } from "./attention";

export async function presentAttentionCase(row: typeof attentionCases.$inferSelect, reader: Pick<typeof db, "execute"> = db): Promise<AttentionCaseView> {
  const reference = AttentionReference.parse({ kind: row.kind, id: row.sourceId, runId: row.runId, occurrence: row.occurrence });
  const current = await findCurrentAttention(row.workspaceId, reference, reader);
  const history = AttentionHandlingHistory.parse(row.entries);
  return AttentionCaseView.parse({ id: row.id, reference, title: redactAttentionText(row.title), status: row.status, revision: row.revision,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), closedAt: row.closedAt?.toISOString() ?? null,
    sourceState: attentionSourceState(reference, current?.occurrence ? { kind: current.kind, id: current.id, runId: current.runId, occurrence: current.occurrence } : null),
    entries: history.map((entry) => ({ requestId: entry.requestId, action: entry.action, reason: redactAttentionText(entry.reason), createdBy: entry.createdBy, createdAt: entry.createdAt })),
  });
}
export async function getAttentionCase(workspaceId: string, caseId: string): Promise<AttentionCaseView | null> {
  z.string().uuid().parse(workspaceId); z.string().uuid().parse(caseId);
  const [row] = await db.select().from(attentionCases).where(and(eq(attentionCases.id, caseId), eq(attentionCases.workspaceId, workspaceId), isNull(attentionCases.archivedAt))).limit(1);
  return row ? presentAttentionCase(row) : null;
}
export async function listAttentionCases(workspaceId: string, input: AttentionCaseListInput): Promise<AttentionCaseListResult> {
  z.string().uuid().parse(workspaceId); const filters = AttentionCaseListInput.parse(input);
  const before = filters.before ? sql`${filters.before}::timestamptz` : undefined;
  const rows = await db.select({ id: attentionCases.id, kind: attentionCases.kind, sourceId: attentionCases.sourceId, runId: attentionCases.runId,
    occurrence: attentionCases.occurrence, title: attentionCases.title, status: attentionCases.status, revision: attentionCases.revision,
    entryCount: sql<number>`jsonb_array_length(${attentionCases.entries})`.mapWith(Number),
    createdAt: sql<string>`to_char(${attentionCases.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    updatedAt: attentionCases.updatedAt, closedAt: attentionCases.closedAt,
  }).from(attentionCases).where(and(eq(attentionCases.workspaceId, workspaceId), isNull(attentionCases.archivedAt),
    filters.status ? eq(attentionCases.status, filters.status) : undefined, filters.kind ? eq(attentionCases.kind, filters.kind) : undefined,
    filters.runId ? eq(attentionCases.runId, filters.runId) : undefined,
    before && filters.beforeId ? or(lt(attentionCases.createdAt, before), and(eq(attentionCases.createdAt, before), lt(attentionCases.id, filters.beforeId))) : undefined,
  )).orderBy(desc(attentionCases.createdAt), desc(attentionCases.id)).limit(filters.limit + 1);
  const selected = rows.slice(0, filters.limit); const last = selected.at(-1);
  return AttentionCaseListResult.parse({ ok: true, items: selected.map((row) => ({ id: row.id, reference: { kind: row.kind, id: row.sourceId, runId: row.runId, occurrence: row.occurrence },
    title: redactAttentionText(row.title), status: row.status, revision: row.revision, entryCount: row.entryCount, createdAt: row.createdAt,
    updatedAt: row.updatedAt.toISOString(), closedAt: row.closedAt?.toISOString() ?? null })), nextCursor: rows.length > filters.limit && last ? { createdAt: last.createdAt, id: last.id } : null });
}
