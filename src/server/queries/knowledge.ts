import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { knowledgeChunks, knowledgeSources } from "@/db/schema";
import { KnowledgeSearchResult, KnowledgeSourceView, type KnowledgeSourceView as KnowledgeSourceViewType } from "@/contracts/knowledge";
import { MAX_KNOWLEDGE_SOURCES_PER_NODE, MAX_WORKFLOW_NODES } from "@/contracts/workflow";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { MAX_KNOWLEDGE_SCAN_CHUNKS, scoreChunks } from "@/server/domain/knowledge/search";
import { parseQueryRows } from "@/server/queries/parse-query-rows";
import { isKnowledgeParsingStalled } from "@/server/domain/knowledge/source-state";
import { escapeLikePattern } from "@/server/domain/search-pattern";
import { redactSensitiveText } from "@/server/domain/security/redact-sensitive";

const MAX_PICKER_SELECTED_SOURCES = MAX_WORKFLOW_NODES * MAX_KNOWLEDGE_SOURCES_PER_NODE;
const PICKER_SELECTED_BATCH_SIZE = 1_000;

function knowledgeSourceView(row: typeof knowledgeSources.$inferSelect, archived = false) {
  return {
    id: row.id, name: row.name, mime: row.mime, sizeBytes: row.sizeBytes,
    status: archived ? "archived" as const : row.status,
    chunkCount: row.chunkCount, charCount: row.charCount, error: row.error ? redactSensitiveText(row.error) : null,
    hasOriginal: Boolean(row.blobPathname),
    parsingStalled: isKnowledgeParsingStalled(row),
    createdAt: row.createdAt.toISOString(),
  };
}

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
  return parseQueryRows("知识资料列表", KnowledgeSourceView, rows.map((row) => knowledgeSourceView(row, archived)));
}

export async function listKnowledgeSourcesForPicker(
  selectedSourceIds: string[],
  limit = 100,
): Promise<KnowledgeSourceViewType[]> {
  const selectedIds = [...new Set(selectedSourceIds)]
    .filter((sourceId) => z.string().uuid().safeParse(sourceId).success)
    .slice(0, MAX_PICKER_SELECTED_SOURCES);
  const recentLimit = Math.min(100, Math.max(1, limit));
  const indexedSources = and(
    eq(knowledgeSources.workspaceId, DEMO_WORKSPACE_ID),
    eq(knowledgeSources.status, "indexed"),
    isNull(knowledgeSources.archivedAt),
  );
  const [recentRows, selectedRows] = await Promise.all([
    db.select().from(knowledgeSources)
      .where(indexedSources)
      .orderBy(desc(knowledgeSources.createdAt))
      .limit(recentLimit),
    (async () => {
      const rows: Array<typeof knowledgeSources.$inferSelect> = [];
      for (let offset = 0; offset < selectedIds.length; offset += PICKER_SELECTED_BATCH_SIZE) {
        const batch = selectedIds.slice(offset, offset + PICKER_SELECTED_BATCH_SIZE);
        rows.push(...await db.select().from(knowledgeSources)
          .where(and(indexedSources, inArray(knowledgeSources.id, batch)))
          .orderBy(desc(knowledgeSources.createdAt)));
      }
      return rows;
    })(),
  ]);
  const mergedRows = [...new Map(
    [...selectedRows, ...recentRows].map((row) => [row.id, row]),
  ).values()];
  return parseQueryRows("流程资料选项", KnowledgeSourceView, mergedRows.map((row) => knowledgeSourceView(row)));
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
