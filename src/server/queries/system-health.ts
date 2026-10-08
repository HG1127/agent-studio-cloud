import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import migrationJournal from "@/db/migrations/meta/_journal.json";

export const LATEST_MIGRATION_WHEN = migrationJournal.entries.at(-1)?.when;
if (!LATEST_MIGRATION_WHEN) throw new Error("数据库迁移清单为空");

export const REQUIRED_DATABASE_OBJECTS = [
  "drizzle.__drizzle_migrations",
  "public.workspaces",
  "public.users",
  "public.agents",
  "public.agent_versions",
  "public.workflow_definitions",
  "public.runs",
  "public.run_steps",
  "public.trace_events",
  "public.approvals",
  "public.knowledge_sources",
  "public.knowledge_chunks",
  "public.schedules",
  "public.schedules_workspace_request_idx",
  "public.model_connections",
  "public.agent_memories",
  "public.evaluation_cases",
  "public.evaluation_runs",
  "public.evaluation_case_results",
  "public.audit_events",
  "public.run_feedback",
  "public.wait_event_submissions",
  "public.tool_operations",
  "public.tool_operations_workspace_key_unique",
  "public.tool_operations_workspace_run_idx",
  "public.tool_operations_workspace_created_id_idx",
  "public.tool_operations_workspace_status_created_id_idx",
  "public.run_deliveries",
  "public.run_deliveries_workspace_run_unique",
  "public.run_deliveries_workspace_status_due_idx",
  "public.run_deliveries_workspace_lease_idx",
  "public.run_deliveries_workspace_status_created_id_idx",
  "public.trace_events_workspace_run_kind_idx",
  "public.attention_cases",
  "public.attention_cases_workspace_source_occurrence_unique",
  "public.attention_cases_workspace_created_id_idx",
  "public.attention_cases_workspace_run_idx",
  "public.runs_workspace_status_created_idx",
  "public.runs_workspace_finished_idx",
  "public.model_calls",
  "public.model_calls_workspace_run_created_idx",
  "public.model_calls_workspace_agent_created_idx",
  "public.runs_workspace_parent_created_idx",
  "public.runs_workspace_legacy_parent_idx",
  "public.runs_workspace_agent_finished_idx",
  "public.runs_workspace_source_key_unique",
  "public.knowledge_sources_workspace_archived_created_idx",
  "public.run_feedback_workspace_run_unique",
  "public.run_feedback_workspace_agent_updated_idx",
  "public.run_feedback_workspace_case_idx",
  "public.wait_event_submissions_token_unique",
  "public.wait_event_submissions_run_created_idx",
  "public.evaluation_runs_workspace_request_unique",
  "public.knowledge_chunks_content_trgm_idx",
  "public.agent_memories_content_trgm_idx",
] as const;

export const REQUIRED_DATABASE_COLUMNS = [
  { tableName: "runs", columnName: "model_usage_tracking_version", requireNotNull: false, allowDefault: false },
  { tableName: "runs", columnName: "parent_run_id", requireNotNull: false, allowDefault: false },
  { tableName: "runs", columnName: "collaboration_tracking_version", requireNotNull: false, allowDefault: false },
  { tableName: "model_calls", columnName: "workspace_id", requireNotNull: true, allowDefault: false },
  { tableName: "model_calls", columnName: "created_by", requireNotNull: true, allowDefault: false },
  { tableName: "model_calls", columnName: "measurement", requireNotNull: false, allowDefault: false },
  { tableName: "run_steps", columnName: "created_by", requireNotNull: true, allowDefault: false },
  { tableName: "trace_events", columnName: "created_by", requireNotNull: true, allowDefault: false },
  { tableName: "trace_events", columnName: "updated_at", requireNotNull: true, allowDefault: true },
  { tableName: "approvals", columnName: "created_by", requireNotNull: true, allowDefault: false },
  { tableName: "knowledge_chunks", columnName: "created_by", requireNotNull: true, allowDefault: false },
  { tableName: "knowledge_chunks", columnName: "updated_at", requireNotNull: true, allowDefault: true },
  { tableName: "evaluation_runs", columnName: "request_id", requireNotNull: false, allowDefault: false },
  { tableName: "schedules", columnName: "request_id", requireNotNull: false, allowDefault: false },
  { tableName: "evaluation_case_results", columnName: "case_snapshot", requireNotNull: false, allowDefault: false },
  { tableName: "tool_operations", columnName: "workspace_id", requireNotNull: true, allowDefault: false },
  { tableName: "tool_operations", columnName: "created_by", requireNotNull: true, allowDefault: false },
  { tableName: "tool_operations", columnName: "retry_deadline", requireNotNull: true, allowDefault: true },
  { tableName: "tool_operations", columnName: "resolutions", requireNotNull: true, allowDefault: true },
  { tableName: "run_deliveries", columnName: "workspace_id", requireNotNull: true, allowDefault: false },
  { tableName: "run_deliveries", columnName: "created_by", requireNotNull: true, allowDefault: false },
  { tableName: "run_deliveries", columnName: "retention_ms", requireNotNull: true, allowDefault: false },
  { tableName: "run_deliveries", columnName: "resolutions", requireNotNull: true, allowDefault: true },
  { tableName: "attention_cases", columnName: "workspace_id", requireNotNull: true, allowDefault: false },
  { tableName: "attention_cases", columnName: "created_by", requireNotNull: true, allowDefault: false },
  { tableName: "attention_cases", columnName: "occurrence", requireNotNull: true, allowDefault: false },
  { tableName: "attention_cases", columnName: "entries", requireNotNull: true, allowDefault: true },
] as const;

export async function isDatabaseReady() {
  const requiredObjects = sql.join(
    REQUIRED_DATABASE_OBJECTS.map((objectName) => sql`(${objectName})`),
    sql`, `,
  );
  const requiredColumns = sql.join(
    REQUIRED_DATABASE_COLUMNS.map((column) => sql`(
      ${column.tableName}, ${column.columnName}, ${column.requireNotNull}, ${column.allowDefault}
    )`),
    sql`, `,
  );
  const rows = await db.execute<{ ready: boolean }>(sql`
      select
      (select bool_and(to_regclass(required.object_name) is not null)
        from (values ${requiredObjects}) as required(object_name))
      and
      (select bool_and(exists(
        select 1
        from information_schema.columns as column_info
        where column_info.table_schema = 'public'
          and column_info.table_name = required_column.table_name
          and column_info.column_name = required_column.column_name
          and (not required_column.require_not_null or column_info.is_nullable = 'NO')
          and (required_column.allow_default or column_info.column_default is null)
      ))
        from (values ${requiredColumns})
          as required_column(table_name, column_name, require_not_null, allow_default))
      as ready
  `);
  if (rows[0]?.ready !== true) return false;
  const migrationRows = await db.execute<{ current: boolean }>(sql`
    select coalesce(max(created_at), 0) >= ${LATEST_MIGRATION_WHEN} as current
    from drizzle.__drizzle_migrations
  `);
  if (migrationRows[0]?.current !== true) return false;
  const tenantRows = await db.execute<{ ready: boolean }>(sql`
    select
      exists (select 1 from public.workspaces where id = ${DEMO_WORKSPACE_ID})
      and exists (
        select 1 from public.users
        where id = ${DEMO_USER_ID} and workspace_id = ${DEMO_WORKSPACE_ID}
      ) as ready
  `);
  return tenantRows[0]?.ready === true;
}
