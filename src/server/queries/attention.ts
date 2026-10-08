import { sql } from "drizzle-orm";
import { z } from "zod";
import { AttentionListInput, AttentionListResult, type AttentionMetadata } from "@/contracts/attention";
import { agents, approvals, runDeliveries, runs, toolOperations, traceEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { presentAttentionItem } from "@/server/domain/attention";
import { ATTENTION_EXPECTED_GRACE_MS, ATTENTION_LONG_PENDING_MS } from "@/contracts/attention-timing";
import { MIN_OPERATIONAL_EPOCH_MS, MAX_OPERATIONAL_EPOCH_MS } from "@/contracts/wait-timing";

export async function listAttention(workspaceId: string, input: AttentionListInput, now = new Date()): Promise<AttentionListResult> {
  const workspace = z.string().uuid().parse(workspaceId);
  const filters = AttentionListInput.parse(input);
  const current = z.number().min(MIN_OPERATIONAL_EPOCH_MS).max(MAX_OPERATIONAL_EPOCH_MS).parse(now.getTime());
  const sources = [
    sql`select case when ${approvals.status} = 'pending' then 'approval-pending' else 'approval-resume' end as kind,
      ${approvals.id} as id, ${approvals.runId} as run_id, ${runs.agentId} as agent_id,
      ${agents.name} as agent_name, ${runs.status} as run_status, ${approvals.nodeTitle} as title,
      null::text as error, ${approvals.createdAt} as created_at, 'none'::text as wait_mode,
      extract(epoch from case when ${approvals.status} = 'pending' then ${approvals.createdAt} else ${approvals.decidedAt} end) * 1000 as since_epoch_ms,
      null::numeric as expected_epoch_ms, null::numeric as retry_epoch_ms
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
      case when ${runs.status} = 'failed' then ${runs.error} else null end as error, ${runs.createdAt} as created_at,
      case when ${runs.status} <> 'waiting_event' then 'none'
        when wait_entry.mode in ('delay', 'until') then 'timer'
        when wait_entry.mode = 'event' or wait_entry.legacy_event then 'event' else 'unknown' end as wait_mode,
      extract(epoch from case when ${runs.status} = 'waiting_event' then wait_entry.at else ${runs.finishedAt} end) * 1000 as since_epoch_ms,
      wait_entry.expected_epoch_ms, null::numeric as retry_epoch_ms
      from ${runs} left join ${agents} on ${agents.id} = ${runs.agentId} and ${agents.workspaceId} = ${runs.workspaceId}
      left join lateral (
        select ${traceEvents.at} as at, ${traceEvents.data} -> 'timing' ->> 'mode' as mode,
          jsonb_typeof(${traceEvents.data} -> 'eventKey') = 'string' and length(${traceEvents.data} ->> 'eventKey') > 0 as legacy_event,
          case when jsonb_typeof(${traceEvents.data} -> 'timing' -> 'expectedAtMs') = 'number'
            and ${traceEvents.data} -> 'timing' ->> 'mode' in ('delay', 'until', 'event')
            and (${traceEvents.data} -> 'timing' ->> 'expectedAtMs') ~ '^-?[0-9]{1,16}$'
            then (${traceEvents.data} -> 'timing' ->> 'expectedAtMs')::numeric else null end as expected_epoch_ms
        from ${traceEvents} where ${traceEvents.runId} = ${runs.id} and ${traceEvents.workspaceId} = ${runs.workspaceId}
          and ${traceEvents.kind} = 'wait.started' and ${runs.status} = 'waiting_event'
        order by ${traceEvents.seq} desc limit 1
      ) as wait_entry on true
      where ${runs.workspaceId} = ${workspace} and ${runs.status} in ('waiting_event', 'failed')`,
    sql`select 'tool-operation'::text as kind, ${toolOperations.id} as id, ${toolOperations.sourceRunId} as run_id,
      ${runs.agentId} as agent_id, ${agents.name} as agent_name, ${runs.status} as run_status,
      ${toolOperations.nodeTitle} as title, ${toolOperations.error} as error, ${toolOperations.createdAt} as created_at,
      'none'::text as wait_mode, extract(epoch from ${toolOperations.updatedAt}) * 1000 as since_epoch_ms,
      null::numeric as expected_epoch_ms, extract(epoch from ${toolOperations.retryDeadline}) * 1000 as retry_epoch_ms
      from ${toolOperations} left join ${runs} on ${runs.id} = ${toolOperations.sourceRunId} and ${runs.workspaceId} = ${toolOperations.workspaceId}
      left join ${agents} on ${agents.id} = ${runs.agentId} and ${agents.workspaceId} = ${toolOperations.workspaceId}
      where ${toolOperations.workspaceId} = ${workspace} and ${toolOperations.status} = 'blocked'`,
    sql`select 'delivery-failed'::text as kind, ${runDeliveries.id} as id, ${runDeliveries.runId} as run_id,
      ${runs.agentId} as agent_id, ${agents.name} as agent_name, ${runs.status} as run_status,
      '成果投递失败'::text as title, ${runDeliveries.error} as error, ${runDeliveries.createdAt} as created_at,
      'none'::text as wait_mode, extract(epoch from ${runDeliveries.updatedAt}) * 1000 as since_epoch_ms,
      null::numeric as expected_epoch_ms, extract(epoch from ${runDeliveries.retryDeadline}) * 1000 as retry_epoch_ms
      from ${runDeliveries} left join ${runs} on ${runs.id} = ${runDeliveries.runId} and ${runs.workspaceId} = ${runDeliveries.workspaceId}
      left join ${agents} on ${agents.id} = ${runs.agentId} and ${agents.workspaceId} = ${runDeliveries.workspaceId}
      where ${runDeliveries.workspaceId} = ${workspace} and ${runDeliveries.status} = 'failed' and ${runDeliveries.archivedAt} is null`,
  ];
  const conditions = [
    filters.kind ? sql`kind = ${filters.kind}` : sql`true`,
    filters.agentId ? sql`agent_id = ${filters.agentId}::uuid` : sql`true`,
    filters.runId ? sql`run_id = ${filters.runId}::uuid` : sql`true`,
    filters.timingState ? sql`timing_state = ${filters.timingState}` : sql`true`,
    filters.before ? sql`(created_at, id, kind COLLATE "C") < (${filters.before}::timestamptz, ${filters.beforeId}::uuid, ${filters.beforeKind}::text COLLATE "C")` : sql`true`,
  ];
  const rows = await db.execute<AttentionMetadata>(sql`
    with raw_attention as (${sql.join(sources, sql` union all `)}),
    normalized as (
      select *,
        case when since_epoch_ms between ${MIN_OPERATIONAL_EPOCH_MS} and ${MAX_OPERATIONAL_EPOCH_MS} then since_epoch_ms else null end as valid_since,
        case when expected_epoch_ms between ${MIN_OPERATIONAL_EPOCH_MS} and ${MAX_OPERATIONAL_EPOCH_MS} then expected_epoch_ms else null end as valid_expected,
        case when retry_epoch_ms between ${MIN_OPERATIONAL_EPOCH_MS} and ${MAX_OPERATIONAL_EPOCH_MS} then retry_epoch_ms else null end as valid_retry
      from raw_attention
    ), attention as (
      select *, case
        when valid_retry <= ${current} then 'retry-expired'
        when valid_expected + ${ATTENTION_EXPECTED_GRACE_MS} <= ${current} then 'expected-overdue'
        when valid_since <= ${current} and wait_mode not in ('timer', 'unknown') and valid_since + ${ATTENTION_LONG_PENDING_MS} <= ${current} then 'long-pending'
        when valid_since is null or valid_since > ${current} or wait_mode = 'unknown' or (wait_mode = 'timer' and valid_expected is null) then 'unknown'
        else 'normal' end as timing_state
      from normalized
    )
    select kind, id, run_id as "runId", agent_id as "agentId", left(agent_name, 200) as "agentName",
      coalesce(length(agent_name) > 200, false) as "agentNameTruncated", run_status as "runStatus",
      left(title, 500) as title, length(title) > 500 as "titleTruncated",
      left(error, 2000) as error, coalesce(length(error) > 2000, false) as "errorTruncated",
      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "createdAt",
      jsonb_build_object('waitMode', wait_mode, 'sinceEpochMs', valid_since, 'expectedEpochMs', valid_expected, 'retryEpochMs', valid_retry) as "timingSource"
    from attention where ${sql.join(conditions, sql` and `)}
    order by created_at desc, id desc, kind COLLATE "C" desc limit ${filters.limit + 1}
  `);
  const items = rows.slice(0, filters.limit).map((row) => presentAttentionItem(row, now));
  const last = items.at(-1);
  return AttentionListResult.parse({ ok: true, items,
    nextCursor: rows.length > filters.limit && last ? { createdAt: last.createdAt, id: last.id, kind: last.kind } : null,
  });
}
