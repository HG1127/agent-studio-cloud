import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { knowledgeSources } from "@/db/schema";
import type { KnowledgeSourceView } from "@/contracts/knowledge";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";

export async function listKnowledgeSources(archived = false): Promise<KnowledgeSourceView[]> {
  const rows = await db
    .select()
    .from(knowledgeSources)
    .where(and(
      eq(knowledgeSources.workspaceId, DEMO_WORKSPACE_ID),
      archived ? isNotNull(knowledgeSources.archivedAt) : isNull(knowledgeSources.archivedAt),
    ))
    .orderBy(desc(knowledgeSources.createdAt));
  return rows.map((row) => ({
    id: row.id, name: row.name, mime: row.mime, sizeBytes: row.sizeBytes,
    status: (archived ? "archived" : row.status) as KnowledgeSourceView["status"],
    chunkCount: row.chunkCount, charCount: row.charCount, error: row.error,
    createdAt: row.createdAt.toISOString(),
  }));
}
