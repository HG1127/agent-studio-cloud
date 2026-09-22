"use step";
// 运行状态机步骤：initializeRun / persistStep / persistContext / finalizeRun / failRun。
// 全部落在 runs / run_steps 两张表，状态机为 queued→running→completed|failed（等待审批在 T12 扩展）。
import { eq, sql } from "drizzle-orm";
import { FatalError } from "workflow";
import type { WorkflowDraft } from "@/contracts/workflow";
import { db } from "@/lib/db";
import { runSteps, runs } from "@/db/schema";
import { appendTrace } from "@/server/steps/trace-step";

async function requireRun(runId: string) {
  const [run] = await db
    .select({ id: runs.id, workspaceId: runs.workspaceId })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  if (!run) throw new FatalError("运行记录不存在，无法继续执行");
  return run;
}

export async function initializeRun(runId: string, draft: WorkflowDraft): Promise<void> {
  "use step";
  await requireRun(runId);
  const now = new Date();
  await db.update(runs).set({ status: "running", startedAt: now, updatedAt: now }).where(eq(runs.id, runId));
  await appendTrace({
    runId,
    nodeId: draft.startNodeId,
    kind: "run.started",
    title: "流程开始执行",
    data: { agentName: draft.rootAgent.name },
  });
}

export type PersistStepStatus = "running" | "succeeded" | "failed";

export interface PersistStepInput {
  runId: string;
  nodeId: string;
  nodeTitle?: string | null;
  nodeType: string;
  status: PersistStepStatus;
  output?: Record<string, unknown> | null;
  error?: string | null;
}

// upsert run_steps（run_id+node_id 唯一）+ runs.stepStates + trace step.*；running 计一次尝试
export async function persistStep(step: PersistStepInput): Promise<void> {
  "use step";
  const run = await requireRun(step.runId);
  const now = new Date();
  const starting = step.status === "running";
  const title = step.nodeTitle ?? step.nodeId;
  await db
    .insert(runSteps)
    .values({
      runId: step.runId,
      workspaceId: run.workspaceId,
      nodeId: step.nodeId,
      nodeTitle: step.nodeTitle ?? null,
      nodeType: step.nodeType,
      status: step.status,
      output: step.output ?? null,
      error: step.error ?? null,
      startedAt: starting ? now : null,
      finishedAt: starting ? null : now,
      attempt: 1,
    })
    .onConflictDoUpdate({
      target: [runSteps.runId, runSteps.nodeId],
      set: starting
        ? { status: "running", startedAt: now, attempt: sql`coalesce(${runSteps.attempt}, 0) + 1`, updatedAt: now }
        : { status: step.status, output: step.output ?? null, error: step.error ?? null, finishedAt: now, updatedAt: now },
    });
  const [current] = await db
    .select({ stepStates: runs.stepStates })
    .from(runs)
    .where(eq(runs.id, step.runId))
    .limit(1);
  const states = {
    ...(current?.stepStates ?? {}),
    [step.nodeId]: { status: step.status, updatedAt: now.toISOString() },
  };
  await db.update(runs).set({ stepStates: states, updatedAt: now }).where(eq(runs.id, step.runId));
  await appendTrace({
    runId: step.runId,
    nodeId: step.nodeId,
    kind: `step.${step.status}`,
    level: step.status === "failed" ? "error" : "info",
    title:
      step.status === "running"
        ? `开始步骤「${title}」`
        : step.status === "succeeded"
          ? `步骤「${title}」完成`
          : `步骤「${title}」失败`,
    detail: step.error ?? null,
    data: step.output ?? null,
  });
}

export async function persistContext(runId: string, outputs: Record<string, unknown>): Promise<void> {
  "use step";
  await requireRun(runId);
  await db.update(runs).set({ context: { outputs }, updatedAt: new Date() }).where(eq(runs.id, runId));
}

export async function finalizeRun(runId: string, result: Record<string, unknown>): Promise<void> {
  "use step";
  await persistContext(runId, result);
  const now = new Date();
  await db.update(runs).set({ status: "completed", result, finishedAt: now, updatedAt: now }).where(eq(runs.id, runId));
  await appendTrace({
    runId,
    kind: "run.completed",
    title: "流程执行完成",
    detail: `共 ${Object.keys(result).length} 个步骤产出`,
  });
}

export async function failRun(runId: string, error: string): Promise<void> {
  "use step";
  const now = new Date();
  await db.update(runs).set({ status: "failed", error, finishedAt: now, updatedAt: now }).where(eq(runs.id, runId));
  await appendTrace({ runId, kind: "run.failed", level: "error", title: "流程执行失败", detail: error });
}
