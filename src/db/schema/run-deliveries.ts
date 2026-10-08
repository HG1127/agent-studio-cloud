import { bigint, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { RunDeliveryEnvelope, RunDeliveryReceipt, RunDeliveryResolution, RunDeliveryStatus } from "@/contracts/run-delivery";

export const runDeliveries = pgTable("run_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull(), createdBy: uuid("created_by").notNull(),
  runId: uuid("run_id").notNull(), targetId: text("target_id").notNull(), targetHash: text("target_hash").notNull(),
  retentionMs: bigint("retention_ms", { mode: "number" }).notNull(), status: text("status").$type<RunDeliveryStatus>().notNull().default("waiting_result"),
  payload: jsonb("payload").$type<RunDeliveryEnvelope>(), receipt: jsonb("receipt").$type<RunDeliveryReceipt>(), error: text("error"),
  attempts: integer("attempts").notNull().default(0), maxAttempts: integer("max_attempts").notNull().default(5),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }), retryDeadline: timestamp("retry_deadline", { withTimezone: true }),
  leaseOwner: uuid("lease_owner"), leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }), workflowRunId: text("workflow_run_id"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }), resolutions: jsonb("resolutions").$type<RunDeliveryResolution[]>().notNull().default([]),
  archivedAt: timestamp("archived_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("run_deliveries_workspace_run_unique").on(t.workspaceId, t.runId),
  index("run_deliveries_workspace_status_due_idx").on(t.workspaceId, t.status, t.nextAttemptAt),
  index("run_deliveries_workspace_lease_idx").on(t.workspaceId, t.leaseExpiresAt),
  index("run_deliveries_workspace_status_created_id_idx").on(t.workspaceId, t.status, t.createdAt, t.id),
]);
