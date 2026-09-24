import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { AgentManifest } from "@/contracts/manifest";
import type { WorkflowDraft } from "@/contracts/workflow";

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    createdBy: uuid("created_by").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    intentText: text("intent_text").notNull(),
    status: text("status").default("draft"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agents_workspace_archived_updated_idx").on(t.workspaceId, t.archivedAt, t.updatedAt)],
);
export type Agent = typeof agents.$inferSelect;

export const agentVersions = pgTable(
  "agent_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    createdBy: uuid("created_by").notNull(),
    version: integer("version").notNull(),
    status: text("status").notNull().default("production"),
    manifest: jsonb("manifest").$type<AgentManifest>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("agent_versions_agent_id_version_unique").on(t.agentId, t.version),
    index("agent_versions_workspace_status_idx").on(t.workspaceId, t.status),
  ],
);
export type AgentVersion = typeof agentVersions.$inferSelect;

export const workflowDefinitions = pgTable(
  "workflow_definitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    createdBy: uuid("created_by").notNull(),
    draft: jsonb("draft").$type<WorkflowDraft>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("workflow_definitions_agent_created_idx").on(t.agentId, t.createdAt)],
);
export type WorkflowDefinition = typeof workflowDefinitions.$inferSelect;
