import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  createdBy: uuid("created_by").notNull(),
  agentId: uuid("agent_id").notNull(),
  versionId: uuid("version_id").notNull(),
  workflowRunId: text("workflow_run_id"),
  status: text("status").notNull().default("queued"),
  input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
  context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
  stepStates: jsonb("step_states").$type<Record<string, unknown>>().notNull().default({}),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type Run = typeof runs.$inferSelect;

export const runSteps = pgTable(
  "run_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
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
  (t) => [uniqueIndex("run_steps_run_id_node_id_unique").on(t.runId, t.nodeId)],
);
export type RunStep = typeof runSteps.$inferSelect;
