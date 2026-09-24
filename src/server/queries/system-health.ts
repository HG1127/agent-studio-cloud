import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export async function isDatabaseReady() {
  const rows = await db.execute<{ ready: boolean }>(sql`
    select bool_and(to_regclass(required.object_name) is not null) as ready
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
    ) as required(object_name)
  `);
  return rows[0]?.ready === true;
}
