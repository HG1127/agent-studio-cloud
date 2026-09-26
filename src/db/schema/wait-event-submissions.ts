import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const waitEventSubmissions = pgTable(
  "wait_event_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    createdBy: uuid("created_by").notNull(),
    runId: uuid("run_id").notNull(),
    eventKey: text("event_key").notNull(),
    submissionTokenHash: text("submission_token_hash").notNull(),
    payloadHash: text("payload_hash").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    hookToken: text("hook_token").notNull(),
    status: text("status").notNull().default("processing"),
    attemptToken: uuid("attempt_token").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("wait_event_submissions_token_unique").on(t.workspaceId, t.submissionTokenHash),
    index("wait_event_submissions_run_created_idx").on(t.workspaceId, t.runId, t.createdAt),
  ],
);

export type WaitEventSubmission = typeof waitEventSubmissions.$inferSelect;
