import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const schedules = pgTable(
  "schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    agentId: uuid("agent_id").notNull(),
    versionId: uuid("version_id").notNull(),
    status: text("status").notNull().default("active"),
    spec: jsonb("spec").$type<Record<string, unknown>>().notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    lastRunId: uuid("last_run_id"),
    lastError: text("last_error"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [index("schedules_workspace_status_next_idx").on(t.workspaceId, t.status, t.nextRunAt)],
);
export type Schedule = typeof schedules.$inferSelect;
