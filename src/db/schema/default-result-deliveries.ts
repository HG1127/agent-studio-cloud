import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { DefaultResultDeliveryAcknowledgement, DefaultResultDeliveryOperation, DefaultResultDeliveryStatus } from "@/contracts/default-result-delivery";
import type { FrozenDefaultResultFrame } from "@/contracts/default-result-stream";

export const defaultResultDeliveries = pgTable("default_result_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(), createdBy: uuid("created_by").notNull(),
  runId: uuid("run_id").notNull(), sdkRunId: text("sdk_run_id").notNull(),
  frozen: jsonb("frozen").$type<FrozenDefaultResultFrame>().notNull(),
  status: text("status").$type<DefaultResultDeliveryStatus>().notNull().default("ready"),
  writeAttempts: integer("write_attempts").notNull().default(0),
  operation: text("operation").$type<DefaultResultDeliveryOperation>(),
  operationToken: text("operation_token"),
  waitingHookToken: text("waiting_hook_token"),
  waitingHookStepId: text("waiting_hook_step_id"),
  acknowledgement: text("acknowledgement").$type<DefaultResultDeliveryAcknowledgement>().notNull().default("none"),
  producerSettled: boolean("producer_settled").notNull().default(true),
  error: text("error"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("default_result_deliveries_workspace_run_unique").on(t.workspaceId, t.runId),
  index("default_result_deliveries_workspace_status_created_idx").on(t.workspaceId, t.status, t.createdAt),
]);
