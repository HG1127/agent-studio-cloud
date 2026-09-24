import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  ApprovalPayload,
  ApprovalView,
  RunAgentOption,
  type RunListFilters,
  RunSummary,
  RunView,
} from "@/contracts/run";
import { agents, approvals, runSteps, runs, type Run, type RunStep } from "@/db/schema";
import { db } from "@/lib/db";

const RUN_ID = z.string().uuid();

export async function listRuns(workspaceId: string, filters: RunListFilters = {}): Promise<RunSummary[]> {
  const rows = await db
    .select({
      id: runs.id,
      agentId: runs.agentId,
      agentName: agents.name,
      status: runs.status,
      sourceType: runs.sourceType,
      agentArchivedAt: agents.archivedAt,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
    })
    .from(runs)
    .innerJoin(agents, eq(agents.id, runs.agentId))
    .where(and(
      eq(runs.workspaceId, workspaceId),
      filters.status ? eq(runs.status, filters.status) : undefined,
      filters.sourceType ? eq(runs.sourceType, filters.sourceType) : undefined,
      filters.agentId ? eq(runs.agentId, filters.agentId) : undefined,
    ))
    .orderBy(desc(runs.createdAt));
  return rows.map((row) =>
    RunSummary.parse({
      id: row.id,
      agentId: row.agentId,
      agentName: row.agentName,
      status: row.status,
      sourceType: row.sourceType,
      agentArchived: row.agentArchivedAt !== null,
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
    }),
  );
}

export async function listRunAgentOptions(workspaceId: string): Promise<RunAgentOption[]> {
  const rows = await db
    .selectDistinct({ id: agents.id, name: agents.name })
    .from(agents)
    .innerJoin(runs, eq(runs.agentId, agents.id))
    .where(eq(runs.workspaceId, workspaceId))
    .orderBy(asc(agents.name));
  return rows.map((row) => RunAgentOption.parse(row));
}

export async function getRunView(runId: string, workspaceId: string): Promise<RunView | null> {
  if (!RUN_ID.safeParse(runId).success) return null;
  const [row] = await db
    .select({ run: runs, agentName: agents.name })
    .from(runs)
    .innerJoin(agents, eq(agents.id, runs.agentId))
    .where(and(eq(runs.id, runId), eq(runs.workspaceId, workspaceId)))
    .limit(1);
  if (!row) return null;
  // 读取再 safeParse 一次，坏数据降级为 404 而不是让页面崩掉
  const parsed = RunView.safeParse({
    id: row.run.id,
    agentId: row.run.agentId,
    agentName: row.agentName,
    status: row.run.status,
    input: row.run.input,
    result: row.run.result ?? null,
    error: row.run.error ?? null,
    startedAt: row.run.startedAt?.toISOString() ?? null,
    finishedAt: row.run.finishedAt?.toISOString() ?? null,
  });
  return parsed.success ? parsed.data : null;
}

// SSE 路由与详情页共用的原始行读取（context/result 等契约外字段）
export async function getRunRow(runId: string, workspaceId: string): Promise<Run | null> {
  if (!RUN_ID.safeParse(runId).success) return null;
  const [row] = await db
    .select()
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.workspaceId, workspaceId)))
    .limit(1);
  return row ?? null;
}

export async function getRunContext(runId: string, workspaceId: string): Promise<Record<string, unknown> | null> {
  if (!RUN_ID.safeParse(runId).success) return null;
  const [row] = await db
    .select({ context: runs.context })
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.workspaceId, workspaceId)))
    .limit(1);
  return row?.context ?? null;
}

export async function listRunSteps(runId: string, workspaceId: string): Promise<RunStep[]> {
  if (!RUN_ID.safeParse(runId).success) return [];
  return db
    .select()
    .from(runSteps)
    .where(and(eq(runSteps.runId, runId), eq(runSteps.workspaceId, workspaceId)))
    .orderBy(asc(runSteps.startedAt), asc(runSteps.createdAt));
}

export async function listApprovals(runId: string, workspaceId: string): Promise<ApprovalView[]> {
  if (!RUN_ID.safeParse(runId).success) return [];
  const rows = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.runId, runId), eq(approvals.workspaceId, workspaceId)))
    .orderBy(asc(approvals.createdAt));
  return rows.map((row) =>
    ApprovalView.parse({
      id: row.id,
      runId: row.runId,
      nodeId: row.nodeId,
      nodeTitle: row.nodeTitle,
      status: row.status,
      role: row.role,
      reason: row.reason,
      review: ApprovalPayload.safeParse(row.payload).data?.review ?? null,
      note: row.note,
      decidedAt: row.decidedAt?.toISOString() ?? null,
    }),
  );
}
