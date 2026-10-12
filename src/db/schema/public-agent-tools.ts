import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { PublicToolPublication } from "@/contracts/public-agent-tool";

export const publicAgentTools = pgTable("public_agent_tools", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull(), createdBy: uuid("created_by").notNull(),
  name: text("name").notNull(), description: text("description").notNull(), status: text("status").notNull().default("draft"),
  revision: integer("revision").notNull().default(1), publication: jsonb("publication").$type<PublicToolPublication>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [index("public_agent_tools_workspace_created_idx").on(t.workspaceId, t.createdAt, t.id)]);
export const publicAgentToolKeys = pgTable("public_agent_tool_keys", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull(), createdBy: uuid("created_by").notNull(),
  toolId: uuid("tool_id").notNull().references(() => publicAgentTools.id), name: text("name").notNull(),
  tokenHash: text("token_hash").notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }), revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [uniqueIndex("public_agent_tool_keys_hash_unique").on(t.tokenHash), index("public_agent_tool_keys_workspace_tool_idx").on(t.workspaceId, t.toolId)]);
export const publicAgentToolCalls = pgTable("public_agent_tool_calls", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull(), createdBy: uuid("created_by").notNull(),
  toolId: uuid("tool_id").notNull().references(() => publicAgentTools.id), keyId: uuid("key_id").notNull().references(() => publicAgentToolKeys.id),
  requestId: uuid("request_id").notNull(), requestHash: text("request_hash").notNull(), origin: text("origin").notNull(),
  publication: jsonb("publication").$type<PublicToolPublication>().notNull(), runId: uuid("run_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [uniqueIndex("public_agent_tool_calls_workspace_request_unique").on(t.workspaceId, t.toolId, t.requestId), uniqueIndex("public_agent_tool_calls_run_unique").on(t.runId)]);
export const publicAgentToolChanges = pgTable("public_agent_tool_changes", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull(), createdBy: uuid("created_by").notNull(),
  toolId: uuid("tool_id").notNull().references(() => publicAgentTools.id), requestId: uuid("request_id").notNull(), requestHash: text("request_hash").notNull(),
  operation: text("operation").notNull(), revision: integer("revision").notNull(), keyId: uuid("key_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [uniqueIndex("public_agent_tool_changes_workspace_request_unique").on(t.workspaceId, t.requestId)]);
