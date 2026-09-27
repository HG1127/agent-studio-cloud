import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const runFeedback = pgTable("run_feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  createdBy: uuid("created_by").notNull(),
  runId: uuid("run_id").notNull(),
  agentId: uuid("agent_id").notNull(),
  rating: text("rating").notNull(),
  note: text("note"),
  evaluationCaseId: uuid("evaluation_case_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("run_feedback_workspace_run_unique").on(t.workspaceId, t.runId),
  index("run_feedback_workspace_agent_updated_idx").on(t.workspaceId, t.agentId, t.updatedAt),
  index("run_feedback_workspace_case_idx").on(t.workspaceId, t.evaluationCaseId),
]);
export type RunFeedback = typeof runFeedback.$inferSelect;
