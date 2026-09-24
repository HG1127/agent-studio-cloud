import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { knowledgeChunks, knowledgeSources } from "@/db/schema";
import { KnowledgeSearchResult, type KnowledgeSourceView } from "@/contracts/knowledge";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { scoreChunks } from "@/server/domain/knowledge/search";

const SEARCH_SCAN_LIMIT = 2_000;

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
    hasOriginal: Boolean(row.blobPathname),
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function searchKnowledgeChunks(query: string) {
  const normalized = query.trim().slice(0, 200);
  if (!normalized) return KnowledgeSearchResult.parse({ query: "", hits: [], truncated: false });
  const rows = await db
    .select({
      sourceId: knowledgeChunks.sourceId,
      sourceName: knowledgeSources.name,
      chunkIndex: knowledgeChunks.chunkIndex,
      content: knowledgeChunks.content,
    })
    .from(knowledgeChunks)
    .innerJoin(knowledgeSources, eq(knowledgeChunks.sourceId, knowledgeSources.id))
    .where(and(
      eq(knowledgeChunks.workspaceId, DEMO_WORKSPACE_ID),
      eq(knowledgeSources.workspaceId, DEMO_WORKSPACE_ID),
      eq(knowledgeSources.status, "indexed"),
      isNull(knowledgeSources.archivedAt),
    ))
    .orderBy(desc(knowledgeSources.createdAt), asc(knowledgeChunks.chunkIndex))
    .limit(SEARCH_SCAN_LIMIT + 1);
  return KnowledgeSearchResult.parse({
    query: normalized,
    hits: scoreChunks(normalized, rows.slice(0, SEARCH_SCAN_LIMIT), { limit: 8 }),
    truncated: rows.length > SEARCH_SCAN_LIMIT,
  });
}
