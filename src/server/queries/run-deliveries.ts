import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { RunTaskReference } from "@/contracts/run-task";
import { RunDeliveryResult } from "@/contracts/run-delivery";
import { runDeliveries, runs } from "@/db/schema";
import { db } from "@/lib/db";
import { redactCredentialText } from "@/server/domain/security/redact-sensitive";

export async function getRunDelivery(runId: string, workspaceId: string): Promise<RunDeliveryResult | null> {
  RunTaskReference.parse({ runId });
  z.string().uuid().parse(workspaceId);
  const [run] = await db.select({ id: runs.id }).from(runs).where(and(eq(runs.id, runId), eq(runs.workspaceId, workspaceId))).limit(1);
  if (!run) return null;
  const [row] = await db.select({ id: runDeliveries.id, runId: runDeliveries.runId, targetId: runDeliveries.targetId, status: runDeliveries.status,
    attempts: runDeliveries.attempts, maxAttempts: runDeliveries.maxAttempts, error: runDeliveries.error, receipt: runDeliveries.receipt,
    nextAttemptAt: runDeliveries.nextAttemptAt, retryDeadline: runDeliveries.retryDeadline, deliveredAt: runDeliveries.deliveredAt,
    createdAt: runDeliveries.createdAt, updatedAt: runDeliveries.updatedAt, resolutions: runDeliveries.resolutions,
  }).from(runDeliveries).where(and(eq(runDeliveries.runId, runId), eq(runDeliveries.workspaceId, workspaceId), isNull(runDeliveries.archivedAt))).limit(1);
  return RunDeliveryResult.parse({ ok: true, runId, delivery: row ? {
    ...row, error: row.error ? redactCredentialText(row.error) : null,
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null, retryDeadline: row.retryDeadline?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  } : null });
}
