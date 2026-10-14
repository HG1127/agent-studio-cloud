import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { AttentionKind } from "@/contracts/attention-reference";
import type { AttentionHandlingEntry, AttentionHandlingStatus } from "@/contracts/attention-handling";

export const attentionCases = pgTable("attention_cases", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull(), createdBy: uuid("created_by").notNull(),
  kind: text("kind").$type<AttentionKind>().notNull(), sourceId: uuid("source_id").notNull(), runId: uuid("run_id").notNull(), occurrence: text("occurrence").notNull(),
  title: text("title").notNull(), status: text("status").$type<AttentionHandlingStatus>().notNull().default("open"), revision: integer("revision").notNull().default(0),
  entries: jsonb("entries").$type<AttentionHandlingEntry[]>().notNull().default([]), closedAt: timestamp("closed_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("attention_cases_workspace_source_occurrence_unique").on(t.workspaceId, t.kind, t.sourceId, t.occurrence),
  index("attention_cases_workspace_created_id_idx").on(t.workspaceId, t.createdAt, t.id),
  index("attention_cases_workspace_run_idx").on(t.workspaceId, t.runId)]);
