import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { HarnessManagedPolicy } from "@/contracts/harness-management";

export const harnessPolicies = pgTable("harness_policies", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull(), createdBy: uuid("created_by").notNull(),
  revision: integer("revision").notNull(), policy: jsonb("policy").$type<HarnessManagedPolicy>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(), archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [uniqueIndex("harness_policies_workspace_unique").on(t.workspaceId)]);

export const harnessPolicyChanges = pgTable("harness_policy_changes", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull(), createdBy: uuid("created_by").notNull(),
  policyId: uuid("policy_id").notNull().references(() => harnessPolicies.id),
  requestId: uuid("request_id").notNull(), requestHash: text("request_hash").notNull(), revision: integer("revision").notNull(),
  previousPolicy: jsonb("previous_policy").$type<HarnessManagedPolicy>(), policy: jsonb("policy").$type<HarnessManagedPolicy>(), reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(), archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [uniqueIndex("harness_policy_changes_workspace_request_unique").on(t.workspaceId, t.requestId),
  uniqueIndex("harness_policy_changes_workspace_revision_unique").on(t.workspaceId, t.revision)]);
