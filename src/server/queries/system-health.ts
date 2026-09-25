import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export async function isDatabaseReady() {
  const rows = await db.execute<{ ready: boolean }>(sql`
    select
      (select bool_and(to_regclass(required.object_name) is not null)
        from (values
          ('public.agents'),
          ('public.agent_versions'),
          ('public.workflow_definitions'),
          ('public.runs'),
          ('public.run_steps'),
          ('public.trace_events'),
          ('public.approvals'),
          ('public.knowledge_sources'),
          ('public.knowledge_chunks'),
          ('public.schedules'),
          ('public.model_connections'),
          ('public.agent_memories'),
          ('public.evaluation_cases'),
          ('public.evaluation_runs'),
          ('public.evaluation_case_results'),
          ('public.audit_events'),
          ('public.runs_workspace_status_created_idx'),
          ('public.knowledge_sources_workspace_archived_created_idx')
        ) as required(object_name))
      and
      (select bool_and(exists(
        select 1
        from information_schema.columns as column_info
        where column_info.table_schema = 'public'
          and column_info.table_name = required_column.table_name
          and column_info.column_name = required_column.column_name
          and column_info.is_nullable = 'NO'
          and (required_column.allow_default or column_info.column_default is null)
      ))
        from (values
          ('run_steps', 'created_by', false),
          ('trace_events', 'created_by', false),
          ('trace_events', 'updated_at', true),
          ('approvals', 'created_by', false),
          ('knowledge_chunks', 'created_by', false),
          ('knowledge_chunks', 'updated_at', true)
        ) as required_column(table_name, column_name, allow_default))
      as ready
  `);
  return rows[0]?.ready === true;
}
