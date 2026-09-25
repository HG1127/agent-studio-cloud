import { and, asc, desc, eq, ilike, isNotNull, isNull } from "drizzle-orm";
import { knowledgeChunks, knowledgeSources } from "@/db/schema";
import { KnowledgeSearchResult, KnowledgeSourceView, type KnowledgeSourceView as KnowledgeSourceViewType } from "@/contracts/knowledge";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { MAX_KNOWLEDGE_SCAN_CHUNKS, scoreChunks } from "@/server/domain/knowledge/search";
import { parseQueryRows } from "@/server/queries/parse-query-rows";
import { isKnowledgeParsingStalled } from "@/server/domain/knowledge/source-state";
import { escapeLikePattern } from "@/server/domain/search-pattern";

export async function listKnowledgeSources(
  archived = false,
  options: { query?: string; limit?: number; offset?: number } = {},
): Promise<KnowledgeSourceViewType[]> {
  const query = options.query?.trim().slice(0, 200);
  const limit = Math.min(101, Math.max(1, options.limit ?? 100));
  const offset = Math.max(0, options.offset ?? 0);
  const rows = await db
    .select()
    .from(knowledgeSources)
    .where(and(
      eq(knowledgeSources.workspaceId, DEMO_WORKSPACE_ID),
      archived ? isNotNull(knowledgeSources.archivedAt) : isNull(knowledgeSources.archivedAt),
      query ? ilike(knowledgeSources.name, `%${escapeLikePattern(query)}%`) : undefined,
    ))
    .orderBy(desc(knowledgeSources.createdAt))
    .limit(limit)
    .offset(offset);
  return parseQueryRows("知识资料列表", KnowledgeSourceView, rows.map((row) => ({
    id: row.id, name: row.name, mime: row.mime, sizeBytes: row.sizeBytes,
    status: archived ? "archived" : row.status,
    chunkCount: row.chunkCount, charCount: row.charCount, error: row.error,
    hasOriginal: Boolean(row.blobPathname),
    parsingStalled: isKnowledgeParsingStalled(row),
    createdAt: row.createdAt.toISOString(),
  })));
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
    .limit(MAX_KNOWLEDGE_SCAN_CHUNKS + 1);
  return KnowledgeSearchResult.parse({
    query: normalized,
    hits: scoreChunks(normalized, rows.slice(0, MAX_KNOWLEDGE_SCAN_CHUNKS), { limit: 8 }),
    truncated: rows.length > MAX_KNOWLEDGE_SCAN_CHUNKS,
  });
}
