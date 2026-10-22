import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { runs } from "@/db/schema";
import { rootRunStartScope } from "@/db/queries/root-run-start-scope";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { RUN_START_LEASE_MS } from "@/server/services/run-start-lease";
import { resumeQueuedRunStartCore } from "@/server/services/start-run-core";

export const MAX_STALE_RUNS_PER_TICK = 5;

export async function recoverStaleQueuedRuns(now = new Date()): Promise<void> {
  try {
    const stale = await db
      .select({ id: runs.id })
      .from(runs)
      .where(and(
        eq(runs.workspaceId, DEMO_WORKSPACE_ID),
        eq(runs.status, "queued"),
        isNull(runs.workflowRunId),
        rootRunStartScope,
        lte(runs.updatedAt, new Date(now.getTime() - RUN_START_LEASE_MS)),
      ))
      .orderBy(asc(runs.updatedAt), asc(runs.id))
      .limit(MAX_STALE_RUNS_PER_TICK);
    let retryableFailure = false;
    for (const run of stale) {
      const result = await resumeQueuedRunStartCore(run.id);
      if (!result.ok && result.retryable) retryableFailure = true;
    }
    if (retryableFailure) throw new Error("部分过期运行接管暂时失败");
  } catch (error) {
    console.error("接管过期排队运行失败", safeErrorForLog(error));
    throw error;
  }
}
