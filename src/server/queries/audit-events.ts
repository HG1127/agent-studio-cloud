import { and, desc, eq, ilike } from "drizzle-orm";
import { AuditEventView, type AuditEventFilters, type AuditEventView as AuditEventViewType } from "@/contracts/audit-event";
import { auditEvents, users } from "@/db/schema";
import { db } from "@/lib/db";

export async function listAuditEvents(
  workspaceId: string,
  filters: AuditEventFilters = {},
  pagination: { limit?: number; offset?: number } = {},
): Promise<AuditEventViewType[]> {
  const limit = Math.min(101, Math.max(1, pagination.limit ?? 100));
  const offset = Math.max(0, pagination.offset ?? 0);
  const query = filters.query?.trim().slice(0, 200);
  const rows = await db
    .select({ event: auditEvents, actorName: users.name })
    .from(auditEvents)
    .leftJoin(users, and(eq(users.id, auditEvents.createdBy), eq(users.workspaceId, auditEvents.workspaceId)))
    .where(and(
      eq(auditEvents.workspaceId, workspaceId),
      filters.targetType ? eq(auditEvents.targetType, filters.targetType) : undefined,
      query ? ilike(auditEvents.summary, `%${query}%`) : undefined,
    ))
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(limit)
    .offset(offset);
  return rows.flatMap(({ event, actorName }) => {
    const parsed = AuditEventView.safeParse({
      ...event,
      actorName: actorName || "未知员工",
      createdAt: event.createdAt.toISOString(),
    });
    return parsed.success ? [parsed.data] : [];
  });
}
