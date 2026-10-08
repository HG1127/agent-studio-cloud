import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { ExecutionResourceLimits } from "@/contracts/execution-resources";

export const executionPolicies = pgTable("execution_policies", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull(), createdBy: uuid("created_by").notNull(),
  revision: integer("revision").notNull(), limits: jsonb("limits").$type<ExecutionResourceLimits>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(), archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [uniqueIndex("execution_policies_workspace_unique").on(t.workspaceId)]);

export const executionPolicyChanges = pgTable("execution_policy_changes", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull(), createdBy: uuid("created_by").notNull(),
  policyId: uuid("policy_id").notNull().references(() => executionPolicies.id),
  requestId: uuid("request_id").notNull(), requestHash: text("request_hash").notNull(), revision: integer("revision").notNull(),
  previousLimits: jsonb("previous_limits").$type<ExecutionResourceLimits>().notNull(), limits: jsonb("limits").$type<ExecutionResourceLimits>().notNull(), reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(), archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [uniqueIndex("execution_policy_changes_workspace_request_unique").on(t.workspaceId, t.requestId), uniqueIndex("execution_policy_changes_workspace_revision_unique").on(t.workspaceId, t.revision)]);
