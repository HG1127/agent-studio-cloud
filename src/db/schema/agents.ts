import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { AgentManifest } from "@/contracts/manifest";
import type { WorkflowDraft } from "@/contracts/workflow";

export const agents = pgTable("agents", {
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
});
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
  (t) => [uniqueIndex("agent_versions_agent_id_version_unique").on(t.agentId, t.version)],
);
export type AgentVersion = typeof agentVersions.$inferSelect;

export const workflowDefinitions = pgTable("workflow_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").notNull(),
  workspaceId: uuid("workspace_id").notNull(),
  createdBy: uuid("created_by").notNull(),
  draft: jsonb("draft").$type<WorkflowDraft>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type WorkflowDefinition = typeof workflowDefinitions.$inferSelect;
