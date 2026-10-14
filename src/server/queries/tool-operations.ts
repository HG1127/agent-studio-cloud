import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { ToolOperationListInput, ToolOperationListResult, ToolOperationView } from "@/contracts/tool-operation";
import { toolOperations } from "@/db/schema";
import { db } from "@/lib/db";
import { redactCredentialData, redactSensitiveText } from "@/server/domain/security/redact-sensitive";

export async function getToolOperation(workspaceId: string, operationId: string): Promise<ToolOperationView | null> {
  if (!z.string().uuid().safeParse(workspaceId).success || !z.string().uuid().safeParse(operationId).success) return null;
  const [row] = await db.select().from(toolOperations).where(and(
    eq(toolOperations.workspaceId, workspaceId), eq(toolOperations.id, operationId),
  )).limit(1);
  if (!row) return null;
  return ToolOperationView.parse({
    id: row.id, sourceRunId: row.sourceRunId, nodeTitle: row.nodeTitle, toolId: row.toolId, status: row.status,
    error: row.error ? redactSensitiveText(row.error) : null, receipt: row.receipt ? redactCredentialData(row.receipt) : null,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    retryDeadline: row.retryDeadline.toISOString(), resolutions: row.resolutions,
  });
}

export async function listToolOperations(workspaceId: string, input: ToolOperationListInput): Promise<ToolOperationListResult> {
  z.string().uuid().parse(workspaceId);
  const filters = ToolOperationListInput.parse(input);
  const before = filters.before ? sql`${filters.before}::timestamptz` : undefined;
  const rows = await db.select({
    id: toolOperations.id, sourceRunId: toolOperations.sourceRunId, nodeTitle: toolOperations.nodeTitle,
    toolId: toolOperations.toolId, status: toolOperations.status, error: toolOperations.error,
    retryDeadline: toolOperations.retryDeadline, createdAt: toolOperations.createdAt, updatedAt: toolOperations.updatedAt,
    resolutionCount: sql<number>`jsonb_array_length(${toolOperations.resolutions})`.mapWith(Number),
    // 游标保留数据库微秒，避免同一毫秒内的记录在翻页时遗漏。
    cursorCreatedAt: sql<string>`to_char(${toolOperations.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
  }).from(toolOperations).where(and(
    eq(toolOperations.workspaceId, workspaceId),
    filters.status ? eq(toolOperations.status, filters.status) : undefined,
    filters.sourceRunId ? eq(toolOperations.sourceRunId, filters.sourceRunId) : undefined,
    before && filters.beforeId ? or(lt(toolOperations.createdAt, before), and(
      eq(toolOperations.createdAt, before), lt(toolOperations.id, filters.beforeId),
    )) : undefined,
  )).orderBy(desc(toolOperations.createdAt), desc(toolOperations.id)).limit(filters.limit + 1);
  const selected = rows.slice(0, filters.limit);
  const last = selected.at(-1);
  return ToolOperationListResult.parse({
    ok: true,
    items: selected.map((row) => ({
      ...row, error: row.error ? redactSensitiveText(row.error) : null,
      retryDeadline: row.retryDeadline.toISOString(), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    })),
    nextCursor: rows.length > filters.limit && last ? { createdAt: last.cursorCreatedAt, id: last.id } : null,
  });
}
