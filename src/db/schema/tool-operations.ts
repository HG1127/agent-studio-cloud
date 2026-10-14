import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { ToolOperationReceipt, ToolOperationStatus, ToolOperationResolution } from "@/contracts/tool-operation";

export const toolOperations = pgTable("tool_operations", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  createdBy: uuid("created_by").notNull(),
  sourceRunId: uuid("source_run_id").notNull(),
  nodeTitle: text("node_title").notNull(),
  toolId: text("tool_id").notNull(),
  action: text("action").notNull(),
  keyHash: text("key_hash").notNull(),
  requestHash: text("request_hash").notNull(),
  status: text("status").$type<ToolOperationStatus>().notNull().default("pending"),
  receipt: jsonb("receipt").$type<ToolOperationReceipt>(),
  error: text("error"),
  leaseOwner: uuid("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  retryDeadline: timestamp("retry_deadline", { withTimezone: true }).notNull().default(new Date(0)),
  resolutions: jsonb("resolutions").$type<ToolOperationResolution[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("tool_operations_workspace_key_unique").on(t.workspaceId, t.keyHash),
  index("tool_operations_workspace_run_idx").on(t.workspaceId, t.sourceRunId),
  index("tool_operations_workspace_created_id_idx").on(t.workspaceId, t.createdAt, t.id),
  index("tool_operations_workspace_status_created_id_idx").on(t.workspaceId, t.status, t.createdAt, t.id),
]);
