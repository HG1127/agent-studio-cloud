import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const knowledgeSources = pgTable(
  "knowledge_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    name: text("name").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    status: text("status").notNull().default("parsing"),
    chunkCount: integer("chunk_count").notNull().default(0),
    charCount: integer("char_count").notNull().default(0),
    parseEngine: text("parse_engine"),
    error: text("error"),
    blobPathname: text("blob_pathname"),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("knowledge_sources_workspace_sha_unique").on(t.workspaceId, t.sha256),
    index("knowledge_sources_workspace_status_idx").on(t.workspaceId, t.status),
    index("knowledge_sources_workspace_archived_created_idx").on(t.workspaceId, t.archivedAt, t.createdAt),
  ],
);
export type KnowledgeSource = typeof knowledgeSources.$inferSelect;

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    createdBy: uuid("created_by").notNull(),
    sourceId: uuid("source_id").notNull().references(() => knowledgeSources.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    charStart: integer("char_start").notNull(),
    charEnd: integer("char_end").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("knowledge_chunks_source_index_unique").on(t.sourceId, t.chunkIndex)],
);
export type KnowledgeChunk = typeof knowledgeChunks.$inferSelect;
