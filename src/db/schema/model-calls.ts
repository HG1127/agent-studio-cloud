import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { ModelCallFailure, ModelCallState, ModelUsageMeasurement } from "@/contracts/model-usage";
import { runs } from "./runs";

export const modelCalls = pgTable("model_calls", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: uuid("workspace_id").notNull(), createdBy: uuid("created_by").notNull(),
  runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }), agentId: uuid("agent_id").notNull(), versionId: uuid("version_id").notNull(),
  nodeId: text("node_id").notNull(), nodeTitle: text("node_title").notNull(), modelId: text("model_id").notNull(), connectionId: uuid("connection_id"),
  state: text("state").$type<ModelCallState>().notNull().default("pending"), measurement: jsonb("measurement").$type<ModelUsageMeasurement>(), failure: text("failure").$type<ModelCallFailure>(),
  finishedAt: timestamp("finished_at", { withTimezone: true }), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(), archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (table) => [index("model_calls_workspace_run_created_idx").on(table.workspaceId, table.runId, table.createdAt), index("model_calls_workspace_agent_created_idx").on(table.workspaceId, table.agentId, table.createdAt)]);
