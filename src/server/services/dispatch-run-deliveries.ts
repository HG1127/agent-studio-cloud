import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { start } from "workflow/api";
import { RUN_DELIVERY_LEASE_MS } from "@/contracts/run-delivery";
import { runDeliveries, runs } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { deliveryAttemptIssue } from "@/server/domain/runtime/run-delivery";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { deliverRunWorkflow } from "@/server/workflows/run-delivery";
import { materializeRunDelivery } from "./run-delivery";

export const MAX_DELIVERIES_PER_TICK = 10;
export async function dispatchPendingDeliveriesCore(workspaceId = DEMO_WORKSPACE_ID): Promise<{ materialized: number; claimed: number }> {
  const now = new Date();
  const waiting = await db.select({ id: runDeliveries.id }).from(runDeliveries).innerJoin(runs, and(eq(runs.id, runDeliveries.runId), eq(runs.workspaceId, runDeliveries.workspaceId)))
    .where(and(eq(runDeliveries.workspaceId, workspaceId), eq(runDeliveries.status, "waiting_result"), isNull(runDeliveries.archivedAt),
      inArray(runs.status, ["completed", "failed", "cancelled"])))
    .orderBy(asc(runDeliveries.createdAt), asc(runDeliveries.id)).limit(MAX_DELIVERIES_PER_TICK);
  let materialized = 0;
  for (const row of waiting) if (await materializeRunDelivery(row.id, workspaceId, now)) materialized++;
  const claimed = await db.transaction(async (tx) => {
    const due = await tx.select().from(runDeliveries).where(and(eq(runDeliveries.workspaceId, workspaceId), isNull(runDeliveries.archivedAt),
      lte(runDeliveries.nextAttemptAt, now), or(eq(runDeliveries.status, "pending"), and(inArray(runDeliveries.status, ["queued", "sending"]), lte(runDeliveries.leaseExpiresAt, now)))))
      .orderBy(asc(runDeliveries.nextAttemptAt), asc(runDeliveries.id)).limit(MAX_DELIVERIES_PER_TICK).for("update", { skipLocked: true });
    const jobs: { id: string; token: string }[] = [];
    for (const row of due) {
      const issue = deliveryAttemptIssue(row, now);
      if (issue) {
        await tx.update(runDeliveries).set({ status: "failed", error: issue, leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: null, updatedAt: now }).where(eq(runDeliveries.id, row.id));
        continue;
      }
      const token = randomUUID();
      await tx.update(runDeliveries).set({ status: "queued", leaseOwner: token, leaseExpiresAt: new Date(now.getTime() + RUN_DELIVERY_LEASE_MS),
        workflowRunId: null, updatedAt: now }).where(eq(runDeliveries.id, row.id));
      jobs.push({ id: row.id, token });
    }
    return jobs;
  });
  for (const job of claimed) {
    try {
      const workflow = await start(deliverRunWorkflow, [job.id, workspaceId, job.token]);
      await db.update(runDeliveries).set({ workflowRunId: workflow.runId, updatedAt: new Date() }).where(and(
        eq(runDeliveries.id, job.id), eq(runDeliveries.workspaceId, workspaceId), eq(runDeliveries.leaseOwner, job.token), isNull(runDeliveries.archivedAt)));
    } catch (error) {
      // 启动响应可能丢失；保留租约，旧工作流与过期接管通过同一标识安全竞争。
      console.error("投递启动结果待确认", safeErrorForLog(error));
    }
  }
  return { materialized, claimed: claimed.length };
}
