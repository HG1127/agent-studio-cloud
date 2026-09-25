"use step";
// 运行状态机步骤：initializeRun / persistStep / persistContext / finalizeRun / failRun。
// 全部落在 runs / run_steps 两张表，状态机为 queued→running→completed|failed，中间可暂停等待确认或外部消息。
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { FatalError } from "workflow";
import type { WorkflowDraft } from "@/contracts/workflow";
import { db } from "@/lib/db";
import { approvals, runSteps, runs } from "@/db/schema";
import { appendTrace } from "@/server/steps/trace-step";
import { completeEvaluationForRun } from "@/server/services/evaluation-state";
import { readRunStartLease, RUN_START_LEASE_KEY } from "@/server/services/run-start-lease";
import {
  jsonStorageIssue,
  MAX_RUN_CONTEXT_BYTES,
  MAX_RUN_RESULT_BYTES,
  MAX_RUN_STEP_OUTPUT_TOTAL_BYTES,
  MAX_STEP_OUTPUT_BYTES,
} from "@/server/domain/runtime/json-storage";

export async function initializeRun(runId: string, draft: WorkflowDraft, startToken?: string): Promise<void> {
  "use step";
  const [run] = await db
    .select({ id: runs.id, workspaceId: runs.workspaceId, status: runs.status, stepStates: runs.stepStates })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1);
  if (!run) throw new FatalError("运行记录不存在，无法继续执行");
  const lease = readRunStartLease(run.stepStates);
  if ((lease && lease.token !== startToken) || (!lease && startToken) || (lease && !startToken)) {
    throw new FatalError("运行启动已由新的请求接管");
  }
  const now = new Date();
  const updated = await db
    .update(runs)
    .set({ status: "running", startedAt: now, updatedAt: now })
    .where(and(
      eq(runs.id, runId),
      eq(runs.status, "queued"),
      startToken
        ? sql<boolean>`${runs.stepStates} -> ${RUN_START_LEASE_KEY} ->> 'token' = ${startToken}`
        : sql<boolean>`${runs.stepStates} -> ${RUN_START_LEASE_KEY} is null`,
    ))
    .returning({ id: runs.id });
  if (updated.length === 0) {
    const [current] = await db
      .select({ status: runs.status, stepStates: runs.stepStates })
      .from(runs)
      .where(eq(runs.id, runId))
      .limit(1);
    const currentLease = readRunStartLease(current?.stepStates);
    if (current?.status === "running" && (
      (startToken && currentLease?.token === startToken)
      || (!startToken && !currentLease)
    )) return;
    throw new FatalError("运行已经结束，不能重新启动");
  }
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
  let rejectedOutput = step.output !== undefined && step.output !== null
    ? jsonStorageIssue(step.output, MAX_STEP_OUTPUT_BYTES, `步骤「${step.nodeTitle ?? step.nodeId}」的输出`)
    : null;
  let storedStep: PersistStepInput = rejectedOutput
    ? { ...step, status: "failed", output: null, error: rejectedOutput }
    : step;
  const now = new Date();
  let starting = storedStep.status === "running";
  const title = step.nodeTitle ?? step.nodeId;
  await db.transaction(async (tx) => {
    // 锁住运行状态直到步骤与摘要一起落库，取消操作要么在前、要么在后，不能插进检查与写入之间。
    const [run] = await tx
      .select({ workspaceId: runs.workspaceId, createdBy: runs.createdBy, status: runs.status, stepStates: runs.stepStates })
      .from(runs)
      .where(eq(runs.id, step.runId))
      .for("update")
      .limit(1);
    if (!run) throw new FatalError("运行记录不存在，无法继续执行");
    if (!["queued", "running", "waiting_approval", "waiting_event"].includes(run.status)) {
      throw new FatalError("运行已经结束，忽略迟到的步骤结果");
    }
    if (!rejectedOutput && storedStep.output !== undefined && storedStep.output !== null) {
      const [aggregate] = await tx
        .select({ bytes: sql<number>`coalesce(sum(octet_length(${runSteps.output}::text)), 0)`.mapWith(Number) })
        .from(runSteps)
        .where(and(eq(runSteps.runId, storedStep.runId), ne(runSteps.nodeId, storedStep.nodeId)));
      const nextBytes = new TextEncoder().encode(JSON.stringify(storedStep.output)).byteLength;
      if ((aggregate?.bytes ?? 0) + nextBytes > MAX_RUN_STEP_OUTPUT_TOTAL_BYTES) {
        rejectedOutput = "这次运行的步骤结果合计不能超过 4MB";
        storedStep = { ...storedStep, status: "failed", output: null, error: rejectedOutput };
        starting = false;
      }
    }
    await tx
      .insert(runSteps)
      .values({
        runId: storedStep.runId,
        workspaceId: run.workspaceId,
        createdBy: run.createdBy,
        nodeId: storedStep.nodeId,
        nodeTitle: storedStep.nodeTitle ?? null,
        nodeType: storedStep.nodeType,
        status: storedStep.status,
        output: storedStep.output ?? null,
        error: storedStep.error ?? null,
        startedAt: starting ? now : null,
        finishedAt: starting ? null : now,
        attempt: 1,
      })
      .onConflictDoUpdate({
        target: [runSteps.runId, runSteps.nodeId],
        set: starting
          ? { status: "running", output: null, error: null, startedAt: now, finishedAt: null, attempt: sql`coalesce(${runSteps.attempt}, 0) + 1`, updatedAt: now }
          : { status: storedStep.status, output: storedStep.output ?? null, error: storedStep.error ?? null, finishedAt: now, updatedAt: now },
      });
    const states = {
      ...(run.stepStates ?? {}),
      [storedStep.nodeId]: { status: storedStep.status, updatedAt: now.toISOString() },
    };
    await tx.update(runs).set({ stepStates: states, updatedAt: now }).where(eq(runs.id, storedStep.runId));
  });
  await appendTrace({
    runId: storedStep.runId,
    nodeId: storedStep.nodeId,
    kind: `step.${storedStep.status}`,
    level: storedStep.status === "failed" ? "error" : "info",
    title:
      storedStep.status === "running"
        ? `开始步骤「${title}」`
        : storedStep.status === "succeeded"
          ? `步骤「${title}」完成`
          : `步骤「${title}」失败`,
    detail: storedStep.error ?? null,
  });
  if (rejectedOutput) throw new FatalError(rejectedOutput);
}

export async function persistContext(runId: string, outputs: Record<string, unknown>): Promise<void> {
  "use step";
  const contextIssue = jsonStorageIssue({ outputs }, MAX_RUN_CONTEXT_BYTES, "运行完整上下文");
  if (contextIssue) throw new FatalError(contextIssue);
  const updated = await db
    .update(runs)
    .set({ context: { outputs }, updatedAt: new Date() })
    .where(and(eq(runs.id, runId), inArray(runs.status, ["queued", "running", "waiting_approval", "waiting_event"])))
    .returning({ id: runs.id });
  if (updated.length > 0) return;
  const [run] = await db.select({ id: runs.id }).from(runs).where(eq(runs.id, runId)).limit(1);
  if (!run) throw new FatalError("运行记录不存在，无法继续执行");
}

export async function finalizeRun(
  runId: string,
  result: Record<string, unknown>,
  contextOutputs: Record<string, unknown> = result,
): Promise<void> {
  "use step";
  const resultIssue = jsonStorageIssue(result, MAX_RUN_RESULT_BYTES, "运行结果");
  if (resultIssue) throw new FatalError(resultIssue);
  const contextIssue = jsonStorageIssue({ outputs: contextOutputs }, MAX_RUN_CONTEXT_BYTES, "运行完整上下文");
  if (contextIssue) throw new FatalError(contextIssue);
  const now = new Date();
  const updated = await db
    .update(runs)
    .set({ status: "completed", result, context: { outputs: contextOutputs }, finishedAt: now, updatedAt: now })
    .where(and(eq(runs.id, runId), inArray(runs.status, ["queued", "running", "waiting_approval", "waiting_event"])))
    .returning({ id: runs.id });
  if (updated.length === 0) return;
  await appendTrace({
    runId,
    kind: "run.completed",
    title: "流程执行完成",
    detail: `共 ${Object.keys(result).length} 个步骤产出`,
  });
  await completeEvaluationForRun(runId, result);
}

export async function failRun(runId: string, error: string): Promise<void> {
  "use step";
  console.error(`运行 ${runId} 失败：${error}`);
  const now = new Date();
  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .update(runs)
      .set({ status: "failed", error, finishedAt: now, updatedAt: now })
      // 等待态也在守卫内：恢复链路抛错时必须能落失败终态，而不是永久卡住
      .where(and(eq(runs.id, runId), inArray(runs.status, ["queued", "running", "waiting_approval", "waiting_event"])))
      .returning({ id: runs.id });
    if (rows.length > 0) {
      await tx
        .update(approvals)
        .set({ status: "rejected", note: "运行失败，确认未继续", decidedAt: now, updatedAt: now })
        .where(and(eq(approvals.runId, runId), eq(approvals.status, "pending")));
    }
    return rows;
  });
  if (updated.length === 0) return; // 已是终态（含终审修复的兜底重入），幂等
  await appendTrace({ runId, kind: "run.failed", level: "error", title: "流程执行失败", detail: error });
  await completeEvaluationForRun(runId, null, error);
}

// 等待结束后把 run 拉回 running 并留下持久轨迹（瞬态状态不可断言，轨迹可）
export async function markRunRunning(runId: string): Promise<boolean> {
  "use step";
  const now = new Date();
  const updated = await db
    .update(runs)
    .set({ status: "running", updatedAt: now })
    .where(and(eq(runs.id, runId), inArray(runs.status, ["waiting_approval", "waiting_event"])))
    .returning({ id: runs.id });
  // 早退在轨迹前：挂起期间 run 已被置终态（手工 DB 路径可达）时不得翻回 running，终态行也不留 run.resumed
  if (updated.length === 0) return false;
  await appendTrace({ runId, kind: "run.resumed", title: "流程继续执行" });
  return true;
}
