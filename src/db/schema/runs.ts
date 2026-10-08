import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    createdBy: uuid("created_by").notNull(),
    agentId: uuid("agent_id").notNull(),
    versionId: uuid("version_id").notNull(),
    workflowRunId: text("workflow_run_id"),
    status: text("status").notNull().default("queued"),
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb("result").$type<Record<string, unknown>>(),
    stepStates: jsonb("step_states").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
    sourceType: text("source_type").notNull().default("manual"),
    sourceKey: text("source_key"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("runs_workspace_source_key_unique").on(t.workspaceId, t.sourceKey).where(sql`source_key is not null`),
    index("runs_workspace_created_idx").on(t.workspaceId, t.createdAt),
    index("runs_workspace_status_created_idx").on(t.workspaceId, t.status, t.createdAt),
    index("runs_workspace_agent_created_idx").on(t.workspaceId, t.agentId, t.createdAt),
    index("runs_workspace_finished_idx").on(t.workspaceId, t.finishedAt),
    index("runs_workspace_agent_finished_idx").on(t.workspaceId, t.agentId, t.finishedAt),
  ],
);
export type Run = typeof runs.$inferSelect;

export const runSteps = pgTable(
  "run_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    createdBy: uuid("created_by").notNull(),
    nodeId: text("node_id").notNull(),
    nodeTitle: text("node_title"),
    nodeType: text("node_type").notNull(),
    status: text("status").notNull().default("pending"),
    attempt: integer("attempt").default(1),
    output: jsonb("output").$type<Record<string, unknown>>(),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("run_steps_run_id_node_id_unique").on(t.runId, t.nodeId),
    index("run_steps_run_id_created_idx").on(t.runId, t.createdAt),
  ],
);
export type RunStep = typeof runSteps.$inferSelect;
