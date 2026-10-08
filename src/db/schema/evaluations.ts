import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { EvaluationCaseSnapshot, EvaluationExpectation, EvaluationResultSchema } from "@/contracts/evaluation";

export const evaluationCases = pgTable("evaluation_cases", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  createdBy: uuid("created_by").notNull(),
  agentId: uuid("agent_id").notNull(),
  name: text("name").notNull(),
  input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
  expectations: jsonb("expectations").$type<EvaluationExpectation[]>().notNull().default([]),
  resultSchema: jsonb("result_schema").$type<EvaluationResultSchema>(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("evaluation_cases_workspace_agent_idx").on(t.workspaceId, t.agentId)]);

export const evaluationRuns = pgTable("evaluation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  createdBy: uuid("created_by").notNull(),
  agentId: uuid("agent_id").notNull(),
  versionId: uuid("version_id").notNull(),
  requestId: uuid("request_id"),
  status: text("status").notNull().default("running"),
  totalCount: integer("total_count").notNull().default(0),
  passedCount: integer("passed_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("evaluation_runs_workspace_request_unique").on(t.workspaceId, t.requestId),
  index("evaluation_runs_workspace_agent_idx").on(t.workspaceId, t.agentId, t.createdAt),
]);

export const evaluationCaseResults = pgTable("evaluation_case_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id").notNull(),
  createdBy: uuid("created_by").notNull(),
  evaluationRunId: uuid("evaluation_run_id").notNull(),
  evaluationCaseId: uuid("evaluation_case_id").notNull(),
  caseSnapshot: jsonb("case_snapshot").$type<EvaluationCaseSnapshot>(),
  runId: uuid("run_id"),
  status: text("status").notNull().default("running"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("evaluation_results_run_case_unique").on(t.evaluationRunId, t.evaluationCaseId),
  index("evaluation_results_run_idx").on(t.evaluationRunId),
]);
