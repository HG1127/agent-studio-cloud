import { inArray, sql } from "drizzle-orm";
import { AttentionIdentifier } from "@/contracts/attention-reference";
import { RunModelUsageAggregate, type RunModelUsage } from "@/contracts/model-usage";
import { modelCalls, runs } from "@/db/schema";
import { db } from "@/lib/db";
import { presentRunModelUsage } from "@/server/domain/model-usage";

export function runModelUsageSnapshotQuery(workspaceId: string, runIds: string[]) {
  const workspace = AttentionIdentifier.parse(workspaceId), ids = runIds.map((id) => AttentionIdentifier.parse(id));
  if (ids.length === 0) throw new Error("运行用量查询范围不能为空");
  const complete = sql`c.state = 'returned' and c.measurement ->> 'knownTotalTokens' is not null and jsonb_array_length(c.measurement -> 'invalidFields') = 0`;
  return sql`
    with scope as (select ${runs.id} as id, ${runs.workspaceId} as workspace_id, ${runs.modelUsageTrackingVersion} as tracking_version
      from ${runs} where ${inArray(runs.id, ids)} and ${runs.workspaceId} = ${workspace}::uuid)
    select r.id::text as "runId", r.tracking_version as "trackingVersion", count(c.id)::text as calls,
      count(c.id) filter (where c.state = 'pending')::text as pending, count(c.id) filter (where c.state = 'returned')::text as returned,
      count(c.id) filter (where c.state = 'failed')::text as failed, count(c.id) filter (where ${complete})::text as "completeCalls",
      count(c.id) filter (where c.state = 'returned' and jsonb_array_length(c.measurement -> 'invalidFields') > 0)::text as "invalidUsageCalls",
      count(c.id) filter (where c.state = 'returned' and c.measurement ->> 'inputTokens' is not null)::text as "inputCalls",
      count(c.id) filter (where c.state = 'returned' and c.measurement ->> 'outputTokens' is not null)::text as "outputCalls",
      (sum((c.measurement ->> 'inputTokens')::numeric) filter (where c.state = 'returned'))::text as "knownInputTokens",
      (sum((c.measurement ->> 'outputTokens')::numeric) filter (where c.state = 'returned'))::text as "knownOutputTokens",
      (sum((c.measurement ->> 'knownTotalTokens')::numeric) filter (where ${complete}))::text as "knownCallTotalTokens"
    from scope r left join ${modelCalls} c on c.run_id = r.id and c.workspace_id = r.workspace_id
    group by r.id, r.tracking_version
  `;
}
export async function getRunModelUsage(workspaceId: string, runId: string, assessedAt = new Date()): Promise<RunModelUsage | null> {
  assessedAt.toISOString();
  const [row] = await db.execute(runModelUsageSnapshotQuery(workspaceId, [runId]));
  return row ? presentRunModelUsage(RunModelUsageAggregate.parse(row), assessedAt) : null;
}
