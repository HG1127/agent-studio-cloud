import { sql } from "drizzle-orm";
import { z } from "zod";
import { AttentionListInput, AttentionListResult, type AttentionMetadata } from "@/contracts/attention";
import { agents, approvals, runDeliveries, runs, toolOperations, traceEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { presentAttentionItem } from "@/server/domain/attention";

export async function listAttention(workspaceId: string, input: AttentionListInput): Promise<AttentionListResult> {
  const workspace = z.string().uuid().parse(workspaceId);
  const filters = AttentionListInput.parse(input);
  const sources = [
    sql`select case when ${approvals.status} = 'pending' then 'approval-pending' else 'approval-resume' end as kind,
      ${approvals.id} as id, ${approvals.runId} as run_id, ${runs.agentId} as agent_id,
      ${agents.name} as agent_name, ${runs.status} as run_status, ${approvals.nodeTitle} as title,
      null::text as error, ${approvals.createdAt} as created_at
      from ${approvals}
      inner join ${runs} on ${runs.id} = ${approvals.runId} and ${runs.workspaceId} = ${approvals.workspaceId}
      left join ${agents} on ${agents.id} = ${runs.agentId} and ${agents.workspaceId} = ${runs.workspaceId}
      where ${approvals.workspaceId} = ${workspace} and ${runs.status} = 'waiting_approval'
        and ${approvals.status} in ('pending', 'approved', 'rejected')
        and not exists(select 1 from ${traceEvents} where ${traceEvents.runId} = ${approvals.runId}
          and ${traceEvents.workspaceId} = ${approvals.workspaceId} and ${traceEvents.kind} = 'approval.decided'
          and ${traceEvents.data} ->> '_dedupeKey' = 'approval-decided:' || ${approvals.id}::text || ':' || ${approvals.status})`,
    sql`select case when ${runs.status} = 'waiting_event' then 'wait-event' else 'run-failed' end as kind,
      ${runs.id} as id, ${runs.id} as run_id, ${runs.agentId} as agent_id, ${agents.name} as agent_name,
      ${runs.status} as run_status, case when ${runs.status} = 'waiting_event' then '等待外部消息' else '任务执行失败' end as title,
      case when ${runs.status} = 'failed' then ${runs.error} else null end as error, ${runs.createdAt} as created_at
      from ${runs} left join ${agents} on ${agents.id} = ${runs.agentId} and ${agents.workspaceId} = ${runs.workspaceId}
      where ${runs.workspaceId} = ${workspace} and ${runs.status} in ('waiting_event', 'failed')`,
    sql`select 'tool-operation'::text as kind, ${toolOperations.id} as id, ${toolOperations.sourceRunId} as run_id,
      ${runs.agentId} as agent_id, ${agents.name} as agent_name, ${runs.status} as run_status,
      ${toolOperations.nodeTitle} as title, ${toolOperations.error} as error, ${toolOperations.createdAt} as created_at
      from ${toolOperations} left join ${runs} on ${runs.id} = ${toolOperations.sourceRunId} and ${runs.workspaceId} = ${toolOperations.workspaceId}
      left join ${agents} on ${agents.id} = ${runs.agentId} and ${agents.workspaceId} = ${toolOperations.workspaceId}
      where ${toolOperations.workspaceId} = ${workspace} and ${toolOperations.status} = 'blocked'`,
    sql`select 'delivery-failed'::text as kind, ${runDeliveries.id} as id, ${runDeliveries.runId} as run_id,
      ${runs.agentId} as agent_id, ${agents.name} as agent_name, ${runs.status} as run_status,
      '成果投递失败'::text as title, ${runDeliveries.error} as error, ${runDeliveries.createdAt} as created_at
      from ${runDeliveries} left join ${runs} on ${runs.id} = ${runDeliveries.runId} and ${runs.workspaceId} = ${runDeliveries.workspaceId}
      left join ${agents} on ${agents.id} = ${runs.agentId} and ${agents.workspaceId} = ${runDeliveries.workspaceId}
      where ${runDeliveries.workspaceId} = ${workspace} and ${runDeliveries.status} = 'failed' and ${runDeliveries.archivedAt} is null`,
  ];
  const conditions = [
    filters.kind ? sql`kind = ${filters.kind}` : sql`true`,
    filters.agentId ? sql`agent_id = ${filters.agentId}::uuid` : sql`true`,
    filters.runId ? sql`run_id = ${filters.runId}::uuid` : sql`true`,
    filters.before ? sql`(created_at, id, kind COLLATE "C") < (${filters.before}::timestamptz, ${filters.beforeId}::uuid, ${filters.beforeKind}::text COLLATE "C")` : sql`true`,
  ];
  const rows = await db.execute<AttentionMetadata>(sql`
    with attention as (${sql.join(sources, sql` union all `)})
    select kind, id, run_id as "runId", agent_id as "agentId", left(agent_name, 200) as "agentName",
      coalesce(length(agent_name) > 200, false) as "agentNameTruncated", run_status as "runStatus",
      left(title, 500) as title, length(title) > 500 as "titleTruncated",
      left(error, 2000) as error, coalesce(length(error) > 2000, false) as "errorTruncated",
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt"
    from attention where ${sql.join(conditions, sql` and `)}
    order by created_at desc, id desc, kind COLLATE "C" desc limit ${filters.limit + 1}
  `);
  const items = rows.slice(0, filters.limit).map(presentAttentionItem);
  const last = items.at(-1);
  return AttentionListResult.parse({ ok: true, items,
    nextCursor: rows.length > filters.limit && last ? { createdAt: last.createdAt, id: last.id, kind: last.kind } : null,
  });
}
