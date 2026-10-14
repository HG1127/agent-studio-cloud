import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { RunTaskResultView, RunTaskStatusView } from "@/contracts/run-task";
import { WorkflowDraft } from "@/contracts/workflow";
import { agentVersions, agents, runs } from "@/db/schema";
import { db } from "@/lib/db";
import { presentRunTaskResult, presentRunTaskStatus } from "@/server/domain/runtime/run-task";

export async function getRunTaskStatus(runId: string, workspaceId: string): Promise<RunTaskStatusView | null> {
  if (!z.string().uuid().safeParse(runId).success || !z.string().uuid().safeParse(workspaceId).success) return null;
  const [row] = await db.select({
    runId: runs.id, agentId: runs.agentId, agentName: agents.name, versionId: runs.versionId, version: agentVersions.version,
    status: runs.status, error: runs.error, startedAt: runs.startedAt, finishedAt: runs.finishedAt,
  }).from(runs).innerJoin(agents, eq(agents.id, runs.agentId)).leftJoin(agentVersions, and(
    eq(agentVersions.id, runs.versionId), eq(agentVersions.agentId, runs.agentId), eq(agentVersions.workspaceId, runs.workspaceId),
  )).where(and(eq(runs.id, runId), eq(runs.workspaceId, workspaceId), eq(agents.workspaceId, workspaceId))).limit(1);
  if (!row) return null;
  return presentRunTaskStatus({
    ...row, status: RunTaskStatusView.shape.status.parse(row.status),
    startedAt: row.startedAt?.toISOString() ?? null, finishedAt: row.finishedAt?.toISOString() ?? null,
  });
}

export async function getRunTaskResult(runId: string, workspaceId: string): Promise<RunTaskResultView | null> {
  if (!z.string().uuid().safeParse(runId).success || !z.string().uuid().safeParse(workspaceId).success) return null;
  const [row] = await db.select({
    runId: runs.id, status: runs.status, error: runs.error,
    result: sql<unknown>`CASE WHEN ${runs.status} = 'completed' THEN ${runs.result} ELSE NULL END`,
    outputContract: sql<unknown>`${agentVersions.manifest} -> 'outputContract'`,
  }).from(runs).innerJoin(agents, eq(agents.id, runs.agentId)).leftJoin(agentVersions, and(
    eq(agentVersions.id, runs.versionId), eq(agentVersions.agentId, runs.agentId), eq(agentVersions.workspaceId, runs.workspaceId),
  )).where(and(eq(runs.id, runId), eq(runs.workspaceId, workspaceId), eq(agents.workspaceId, workspaceId))).limit(1);
  if (!row) return null;
  return presentRunTaskResult({
    runId: row.runId, status: RunTaskResultView.shape.status.parse(row.status), error: row.error,
    result: RunTaskResultView.shape.result.parse(row.result),
    outputContract: WorkflowDraft.shape.outputContract.parse(row.outputContract ?? undefined) ?? { fields: [] },
  });
}
