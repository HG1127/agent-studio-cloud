import { sql } from "drizzle-orm";
import { z } from "zod";
import { RuntimeOverviewAggregate, RuntimeOverviewInput, type RuntimeOverview } from "@/contracts/runtime-overview";
import { runs } from "@/db/schema";
import { db } from "@/lib/db";
import { presentRuntimeOverview, runtimeOverviewBounds } from "@/server/domain/runtime-overview";

export async function getRuntimeOverview(workspaceId: string, input: RuntimeOverviewInput, now = new Date()): Promise<RuntimeOverview> {
  const workspace = z.string().uuid().parse(workspaceId), filters = RuntimeOverviewInput.parse(input);
  const bounds = runtimeOverviewBounds(filters.window, now);
  const from = sql`${bounds.from}::timestamptz`, until = sql`${bounds.until}::timestamptz`;
  const received = sql`created_at >= ${from} and created_at < ${until}`;
  const finished = sql`status in ('completed', 'failed', 'cancelled') and finished_at >= ${from} and finished_at < ${until}`;
  const active = sql`status in ('queued', 'running', 'waiting_approval', 'waiting_event')`;
  const knownQueuedTime = sql`created_at >= '0001-01-01T00:00:00Z'::timestamptz and created_at <= ${until}`;
  const validDuration = sql`started_at >= created_at and finished_at >= started_at and created_at >= '0001-01-01T00:00:00Z'::timestamptz`;
  const [raw] = await db.execute(sql`
    with scoped as (
      select ${runs.status} as status, ${runs.sourceType} as source_type, ${runs.createdAt} as created_at, ${runs.startedAt} as started_at, ${runs.finishedAt} as finished_at
      from ${runs} where ${runs.workspaceId} = ${workspace}
        and ${filters.agentId ? sql`${runs.agentId} = ${filters.agentId}::uuid` : sql`true`}
        and ${filters.sourceType ? sql`${runs.sourceType} = ${filters.sourceType}` : sql`true`}
        and (${runs.status} in ('queued', 'running', 'waiting_approval', 'waiting_event')
          or (${runs.createdAt} >= ${from} and ${runs.createdAt} < ${until}) or (${runs.finishedAt} >= ${from} and ${runs.finishedAt} < ${until}))
    )
    select count(*) filter (where status = 'queued')::text as queued,
      count(*) filter (where status = 'running')::text as running,
      count(*) filter (where status = 'waiting_approval')::text as "waitingApproval",
      count(*) filter (where status = 'waiting_event')::text as "waitingEvent",
      to_char(min(created_at) filter (where status = 'queued' and ${knownQueuedTime}) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "oldestQueuedReceivedAt",
      (floor(extract(epoch from (${until} - min(created_at) filter (where status = 'queued' and ${knownQueuedTime})))))::bigint::text as "oldestQueuedReceivedAgeSeconds",
      count(*) filter (where status = 'queued' and not (${knownQueuedTime}))::text as "queuedTimeUnknown",
      count(*) filter (where ${active} and finished_at is not null)::text as "activeWithEndTime",
      count(*) filter (where ${received})::text as received,
      count(*) filter (where ${received} and status not in ('queued', 'running', 'waiting_approval', 'waiting_event', 'completed', 'failed', 'cancelled'))::text as "receivedUnknownStatus",
      count(*) filter (where ${received} and source_type = 'manual')::text as manual,
      count(*) filter (where ${received} and source_type = 'schedule')::text as schedule,
      count(*) filter (where ${received} and source_type = 'agent_call')::text as "agentCall",
      count(*) filter (where ${received} and source_type = 'handoff')::text as handoff,
      count(*) filter (where ${received} and source_type = 'evaluation')::text as evaluation,
      count(*) filter (where ${received} and source_type not in ('manual', 'schedule', 'agent_call', 'handoff', 'evaluation'))::text as "unknownSource",
      count(*) filter (where ${finished} and status = 'completed')::text as completed,
      count(*) filter (where ${finished} and status = 'failed')::text as failed,
      count(*) filter (where ${finished} and status = 'cancelled')::text as cancelled,
      count(*) filter (where ${finished} and ${validDuration})::text as "knownDuration",
      count(*) filter (where ${finished} and (started_at is null or not (${validDuration})))::text as "unknownDuration",
      (avg(extract(epoch from (finished_at - started_at)) * 1000) filter (where ${finished} and ${validDuration}))::text as "meanDurationMs",
      (percentile_cont(0.95) within group (order by extract(epoch from (finished_at - started_at)) * 1000) filter (where ${finished} and ${validDuration}))::numeric::text as "p95DurationMs"
    from scoped
  `);
  return presentRuntimeOverview(filters, bounds, RuntimeOverviewAggregate.parse(raw));
}
