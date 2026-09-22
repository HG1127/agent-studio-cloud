import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { ApprovalView, RunSummary, RunView } from "@/contracts/run";
import { agents, approvals, runSteps, runs, type Run, type RunStep } from "@/db/schema";
import { db } from "@/lib/db";

const RUN_ID = z.string().uuid();

export async function listRuns(workspaceId: string): Promise<RunSummary[]> {
  const rows = await db
    .select({
      id: runs.id,
      agentId: runs.agentId,
      agentName: agents.name,
      status: runs.status,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
    })
    .from(runs)
    .innerJoin(agents, eq(agents.id, runs.agentId))
    .where(eq(runs.workspaceId, workspaceId))
    .orderBy(desc(runs.createdAt));
  return rows.map((row) =>
    RunSummary.parse({
      id: row.id,
      agentId: row.agentId,
      agentName: row.agentName,
      status: row.status,
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
    }),
  );
}

export async function getRunView(runId: string): Promise<RunView | null> {
  if (!RUN_ID.safeParse(runId).success) return null;
  const [row] = await db
    .select({ run: runs, agentName: agents.name })
    .from(runs)
    .innerJoin(agents, eq(agents.id, runs.agentId))
    .where(eq(runs.id, runId))
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
export async function getRunRow(runId: string): Promise<Run | null> {
  if (!RUN_ID.safeParse(runId).success) return null;
  const [row] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  return row ?? null;
}

export async function getRunContext(runId: string): Promise<Record<string, unknown> | null> {
  if (!RUN_ID.safeParse(runId).success) return null;
  const [row] = await db.select({ context: runs.context }).from(runs).where(eq(runs.id, runId)).limit(1);
  return row?.context ?? null;
}

export async function listRunSteps(runId: string): Promise<RunStep[]> {
  if (!RUN_ID.safeParse(runId).success) return [];
  return db
    .select()
    .from(runSteps)
    .where(eq(runSteps.runId, runId))
    .orderBy(asc(runSteps.startedAt), asc(runSteps.createdAt));
}

export async function listApprovals(runId: string): Promise<ApprovalView[]> {
  if (!RUN_ID.safeParse(runId).success) return [];
  const rows = await db
    .select()
    .from(approvals)
    .where(eq(approvals.runId, runId))
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
      note: row.note,
      decidedAt: row.decidedAt?.toISOString() ?? null,
    }),
  );
}
