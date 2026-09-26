import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
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
  "public.model_connections",
  "public.agent_memories",
  "public.evaluation_cases",
  "public.evaluation_runs",
  "public.evaluation_case_results",
  "public.audit_events",
  "public.run_feedback",
  "public.wait_event_submissions",
  "public.runs_workspace_status_created_idx",
  "public.runs_workspace_source_key_unique",
  "public.knowledge_sources_workspace_archived_created_idx",
  "public.run_feedback_workspace_run_unique",
  "public.run_feedback_workspace_agent_updated_idx",
  "public.wait_event_submissions_token_unique",
  "public.wait_event_submissions_run_created_idx",
  "public.evaluation_runs_workspace_request_unique",
] as const;

export const REQUIRED_DATABASE_COLUMNS = [
  { tableName: "run_steps", columnName: "created_by", requireNotNull: true, allowDefault: false },
  { tableName: "trace_events", columnName: "created_by", requireNotNull: true, allowDefault: false },
  { tableName: "trace_events", columnName: "updated_at", requireNotNull: true, allowDefault: true },
  { tableName: "approvals", columnName: "created_by", requireNotNull: true, allowDefault: false },
  { tableName: "knowledge_chunks", columnName: "created_by", requireNotNull: true, allowDefault: false },
  { tableName: "knowledge_chunks", columnName: "updated_at", requireNotNull: true, allowDefault: true },
  { tableName: "evaluation_runs", columnName: "request_id", requireNotNull: false, allowDefault: false },
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
  return migrationRows[0]?.current === true;
}
