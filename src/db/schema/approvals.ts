import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull(),
    workspaceId: uuid("workspace_id").notNull(),
    nodeId: text("node_id").notNull(),
    nodeTitle: text("node_title").notNull(),
    status: text("status").notNull().default("pending"),
    role: text("role").notNull(),
    reason: text("reason").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    note: text("note"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("approvals_run_id_idx").on(t.runId)],
);
export type Approval = typeof approvals.$inferSelect;
