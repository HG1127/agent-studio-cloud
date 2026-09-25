import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const traceEvents = pgTable(
  "trace_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    createdBy: uuid("created_by").notNull(),
    seq: integer("seq").notNull(),
    nodeId: text("node_id"),
    kind: text("kind").notNull(),
    level: text("level").notNull().default("info"),
    title: text("title").notNull(),
    detail: text("detail"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("trace_events_run_id_seq_unique").on(t.runId, t.seq)],
);
export type TraceEvent = typeof traceEvents.$inferSelect;
