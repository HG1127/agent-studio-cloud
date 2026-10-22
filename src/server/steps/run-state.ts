"use step";
// 运行状态机步骤：initializeRun / persistStep / persistContext / finalizeRun / failRun。
// 全部落在 runs / run_steps 两张表，状态机为 queued→running→completed|failed，中间可暂停等待确认或外部消息。
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { FatalError, getStepMetadata, getWorkflowMetadata } from "workflow";
import { RunExecutionClaim } from "@/contracts/run-execution-binding";
import { DEFAULT_RESULT_TRACKING_VERSION, type RunCompletionOutcome } from "@/contracts/default-result-delivery";
import type { HarnessPolicySnapshot } from "@/contracts/harness-management";
import type { WorkflowDraft, WorkflowOutputField } from "@/contracts/workflow";
import type { InlineOutputReferences } from "@/contracts/inline-output-reference";
import { projectWorkflowResult } from "@/server/domain/runtime/output-contract";
import { db } from "@/lib/db";
import { approvals, runSteps, runs } from "@/db/schema";
import { appendTrace } from "@/server/steps/trace-step";
import { completeEvaluationForRun, reconcileTerminalEvaluationRun } from "@/server/services/evaluation-state";
import { readRunStartLease, RUN_START_LEASE_KEY } from "@/server/services/run-start-lease";
import {
  jsonStorageIssue,
  MAX_RUN_CONTEXT_BYTES,
  MAX_RUN_RESULT_BYTES,
  MAX_RUN_STEP_OUTPUT_TOTAL_BYTES,
  stepOutputStorageIssue,
} from "@/server/domain/runtime/json-storage";
import { redactSensitiveText } from "@/server/domain/security/redact-sensitive";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { withSafeWorkflowError } from "@/server/security/workflow-error";
import { runInitializationIssue } from "@/server/domain/runtime/run-execution-binding";
import { completeRunResult } from "@/server/services/complete-run-result";
import { HarnessPolicyDataError } from "@/server/domain/harness/management";
import { freezeRunHarnessPolicy } from "@/server/services/harness-policies";

function workflowStepId(): string {
  try {
    return getStepMetadata().stepId;
  } catch {
    return "direct-call";
  }
}

export async function initializeRun(runId: string, draft: WorkflowDraft, startToken?: string): Promise<void> {
  "use step";
  let claim: RunExecutionClaim;
  try {
    claim = RunExecutionClaim.parse({ sdkRunId: getWorkflowMetadata().workflowRunId, startToken: startToken ?? null });
  } catch {
    throw new FatalError("运行执行身份无法确认，不能继续执行");
  }
  const stepId = workflowStepId();
  const [run] = await withSafeWorkflowError(() => db
    .select({ id: runs.id, workspaceId: runs.workspaceId, status: runs.status, stepStates: runs.stepStates, workflowRunId: runs.workflowRunId })
    .from(runs)
    .where(eq(runs.id, runId))
    .limit(1), "运行状态暂时无法读取，请稍后重试");
  if (!run) throw new FatalError("运行记录不存在，无法继续执行");
  const lease = readRunStartLease(run.stepStates);
  const issue = runInitializationIssue({ status: run.status, sdkRunId: run.workflowRunId, startToken: lease?.token ?? (Object.hasOwn(run.stepStates, RUN_START_LEASE_KEY) ? undefined : null) }, claim);
  if (issue) throw new FatalError(issue);
  const now = new Date();
  const updated = await withSafeWorkflowError(() => db.transaction(async (tx) => {
    const [locked] = await tx.select({ workspaceId: runs.workspaceId, status: runs.status, stepStates: runs.stepStates,
      workflowRunId: runs.workflowRunId, parentRunId: runs.parentRunId, sourceType: runs.sourceType, harnessPolicySnapshot: runs.harnessPolicySnapshot })
      .from(runs).where(and(eq(runs.id, runId), eq(runs.workspaceId, run.workspaceId))).for("update").limit(1);
    if (!locked) throw new FatalError("运行记录不存在，无法继续执行");
    const lockedLease = readRunStartLease(locked.stepStates);
    const lockedIssue = runInitializationIssue({ status: locked.status, sdkRunId: locked.workflowRunId,
      startToken: lockedLease?.token ?? (Object.hasOwn(locked.stepStates, RUN_START_LEASE_KEY) ? undefined : null) }, claim);
    if (lockedIssue) throw new FatalError(lockedIssue);
    if (locked.status === "running") return [];
    let harnessPolicySnapshot: HarnessPolicySnapshot | null;
    try {
      harnessPolicySnapshot = await freezeRunHarnessPolicy(tx, locked, now);
    } catch (error) {
      if (error instanceof HarnessPolicyDataError) throw new FatalError(error.message);
      throw error;
    }
    return tx.update(runs)
      .set({ status: "running", workflowRunId: claim.sdkRunId, startedAt: now, updatedAt: now, modelUsageTrackingVersion: "v1", collaborationTrackingVersion: "v1", defaultResultTrackingVersion: DEFAULT_RESULT_TRACKING_VERSION, harnessPolicySnapshot })
      .where(and(
        eq(runs.id, runId),
        eq(runs.workspaceId, run.workspaceId),
        eq(runs.status, "queued"),
        or(isNull(runs.workflowRunId), eq(runs.workflowRunId, claim.sdkRunId)),
        startToken
          ? sql<boolean>`${runs.stepStates} -> ${RUN_START_LEASE_KEY} ->> 'token' = ${startToken}`
          : sql<boolean>`${runs.stepStates} -> ${RUN_START_LEASE_KEY} is null`,
      )).returning({ id: runs.id });
  }), "运行状态或运行规则暂时无法更新，请稍后重试");
  if (updated.length === 0) {
    const [current] = await withSafeWorkflowError(() => db
      .select({ status: runs.status, stepStates: runs.stepStates, workflowRunId: runs.workflowRunId })
      .from(runs)
      .where(and(eq(runs.id, runId), eq(runs.workspaceId, run.workspaceId)))
      .limit(1), "运行状态暂时无法读取，请稍后重试");
    const currentLease = readRunStartLease(current?.stepStates);
    const currentIssue = runInitializationIssue({ status: current?.status, sdkRunId: current?.workflowRunId, startToken: currentLease?.token ?? (current && !Object.hasOwn(current.stepStates, RUN_START_LEASE_KEY) ? null : undefined) }, claim);
    if (current?.status === "running" && !currentIssue) {
      await appendTrace({
        runId,
        nodeId: draft.startNodeId,
        kind: "run.started",
        title: "流程开始执行",
        data: { agentName: draft.rootAgent.name },
        dedupeKey: `run-started:${startToken ?? stepId}`,
      });
      return;
    }
    throw new FatalError(currentIssue ?? "运行状态尚未确认，不能重新启动");
  }
  await appendTrace({
    runId,
    nodeId: draft.startNodeId,
    kind: "run.started",
    title: "流程开始执行",
    data: { agentName: draft.rootAgent.name },
    dedupeKey: `run-started:${startToken ?? stepId}`,
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
  emitTrace?: boolean;
}

async function appendCommittedStepTrace(step: PersistStepInput, stepId: string): Promise<void> {
  const title = step.nodeTitle ?? step.nodeId;
  const event = {
    runId: step.runId,
    nodeId: step.nodeId,
    kind: `step.${step.status}`,
    level: step.status === "failed" ? "error" as const : "info" as const,
    title:
      step.status === "running"
        ? `开始步骤「${title}」`
        : step.status === "succeeded"
          ? `步骤「${title}」完成`
          : `步骤「${title}」失败`,
    detail: step.error ?? null,
    dedupeKey: `step:${stepId}:${step.nodeId}:${step.status}`,
  };
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await appendTrace(event);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  // 步骤结果已经提交；此时重抛会让模型或外部动作整体重放，轨迹降级不能制造重复业务副作用。
  console.error(`步骤 ${step.runId}/${step.nodeId} 的运行轨迹写入失败`, safeErrorForLog(lastError));
}

// upsert run_steps（run_id+node_id 唯一）+ runs.stepStates + trace step.*；running 计一次尝试
export async function persistStep(step: PersistStepInput): Promise<void> {
  "use step";
  const stepId = workflowStepId();
  const safeStep = step.error ? { ...step, error: redactSensitiveText(step.error) } : step;
  let rejectedOutput = safeStep.output !== undefined && safeStep.output !== null
    ? stepOutputStorageIssue(safeStep.output, safeStep.nodeType, `步骤「${safeStep.nodeTitle ?? safeStep.nodeId}」的输出`)
    : null;
  let storedStep: PersistStepInput = rejectedOutput
    ? { ...safeStep, status: "failed", output: null, error: rejectedOutput }
    : safeStep;
  const now = new Date();
  let starting = storedStep.status === "running";
  await withSafeWorkflowError(() => db.transaction(async (tx) => {
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
  }), "步骤状态暂时无法保存，请稍后重试");
  if (storedStep.emitTrace !== false) {
    await appendCommittedStepTrace(storedStep, stepId);
  }
  if (rejectedOutput) throw new FatalError(rejectedOutput);
}

export async function persistContext(runId: string, outputs: Record<string, unknown>): Promise<void> {
  "use step";
  const contextIssue = jsonStorageIssue({ outputs }, MAX_RUN_CONTEXT_BYTES, "运行完整上下文");
  if (contextIssue) throw new FatalError(contextIssue);
  const updated = await withSafeWorkflowError(() => db
    .update(runs)
    .set({ context: { outputs }, updatedAt: new Date() })
    .where(and(eq(runs.id, runId), inArray(runs.status, ["queued", "running", "waiting_approval", "waiting_event"])))
    .returning({ id: runs.id }), "运行上下文暂时无法保存，请稍后重试");
  if (updated.length > 0) return;
  const [run] = await withSafeWorkflowError(
    () => db.select({ id: runs.id }).from(runs).where(eq(runs.id, runId)).limit(1),
    "运行状态暂时无法读取，请稍后重试",
  );
  if (!run) throw new FatalError("运行记录不存在，无法继续执行");
  throw new FatalError("运行已经结束，忽略迟到的上下文");
}

export async function finalizeRun(
  runId: string,
  result: Record<string, unknown>,
  contextOutputs: Record<string, unknown> = result,
  outcome: "completed" | "not_approved" = "completed",
): Promise<RunCompletionOutcome> {
  "use step";
  return persistCompletedRun(runId, result, contextOutputs, outcome);
}

export async function finalizeWorkflowResult(args: {
  runId: string;
  outputs: Record<string, unknown>;
  fields: WorkflowOutputField[];
  inlineReferences?: InlineOutputReferences;
}): Promise<RunCompletionOutcome> {
  "use step";
  const projected = projectWorkflowResult(args.outputs, args.fields, args.inlineReferences);
  if (!projected.ok) throw new FatalError(`缺少必需交付内容：${projected.missing.join("、")}`);
  return persistCompletedRun(args.runId, projected.result, args.outputs);
}

async function persistCompletedRun(runId: string, result: Record<string, unknown>, contextOutputs: Record<string, unknown>, outcome: "completed" | "not_approved" = "completed"): Promise<RunCompletionOutcome> {
  const resultIssue = jsonStorageIssue(result, MAX_RUN_RESULT_BYTES, "运行结果");
  if (resultIssue) throw new FatalError(resultIssue);
  const contextIssue = jsonStorageIssue({ outputs: contextOutputs }, MAX_RUN_CONTEXT_BYTES, "运行完整上下文");
  if (contextIssue) throw new FatalError(contextIssue);
  const completed = await completeRunResult({ runId, result, contextOutputs, outcome, expectedSdkRunId: getWorkflowMetadata().workflowRunId });
  if (completed.outcome.kind === "stopped") return completed.outcome;
  const savedResult = completed.result ?? {};
  if (!completed.newlyCompleted) {
    // 终态写入后若验收汇总瞬时失败，Workflow 会重试本步骤；重入时仍需完成对账。
    await appendTrace({ runId, kind: "run.completed", title: "流程执行完成", detail: `共 ${Object.keys(savedResult).length} 个步骤产出` });
    await withSafeWorkflowError(
      () => reconcileTerminalEvaluationRun(runId),
      "验收结果暂时无法汇总，请稍后重试",
    );
    return completed.outcome;
  }
  await appendTrace({
    runId,
    kind: "run.completed",
    title: "流程执行完成",
    detail: `共 ${Object.keys(savedResult).length} 个步骤产出`,
  });
  await withSafeWorkflowError(
    () => completeEvaluationForRun(runId, savedResult),
    "验收结果暂时无法汇总，请稍后重试",
  );
  return completed.outcome;
}

export async function failRun(runId: string, error: string): Promise<void> {
  "use step";
  const safeError = redactSensitiveText(error);
  console.error(`运行 ${runId} 失败：${safeError}`);
  const now = new Date();
  const updated = await withSafeWorkflowError(() => db.transaction(async (tx) => {
    const rows = await tx
      .update(runs)
      .set({ status: "failed", error: safeError, finishedAt: now, updatedAt: now })
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
  }), "运行失败状态暂时无法保存，请稍后重试");
  if (updated.length === 0) {
    const [current] = await withSafeWorkflowError(() => db
      .select({ status: runs.status })
      .from(runs)
      .where(eq(runs.id, runId))
      .limit(1), "运行状态暂时无法读取，请稍后重试");
    if (current?.status !== "failed") return;
    // 已是失败终态时不改写运行结果，但要修复上一次可能未完成的验收汇总。
    await appendTrace({ runId, kind: "run.failed", level: "error", title: "流程执行失败", detail: safeError });
    await withSafeWorkflowError(
      () => reconcileTerminalEvaluationRun(runId),
      "验收结果暂时无法汇总，请稍后重试",
    );
    return;
  }
  await appendTrace({ runId, kind: "run.failed", level: "error", title: "流程执行失败", detail: safeError });
  await withSafeWorkflowError(
    () => completeEvaluationForRun(runId, null, safeError),
    "验收结果暂时无法汇总，请稍后重试",
  );
}

// 等待结束后把 run 拉回 running 并留下持久轨迹（瞬态状态不可断言，轨迹可）
export async function markRunRunning(runId: string): Promise<boolean> {
  "use step";
  const stepId = workflowStepId();
  const now = new Date();
  const updated = await withSafeWorkflowError(() => db
    .update(runs)
    .set({ status: "running", updatedAt: now })
    .where(and(eq(runs.id, runId), inArray(runs.status, ["waiting_approval", "waiting_event"])))
    .returning({ id: runs.id }), "运行状态暂时无法更新，请稍后重试");
  if (updated.length === 0) {
    const [current] = await withSafeWorkflowError(() => db
      .select({ status: runs.status })
      .from(runs)
      .where(eq(runs.id, runId))
      .limit(1), "运行状态暂时无法读取，请稍后重试");
    // 状态已由本步骤的上一次尝试切换成功时，继续补齐轨迹；终态仍严格拒绝恢复。
    if (current?.status !== "running") return false;
  }
  await appendTrace({
    runId,
    kind: "run.resumed",
    title: "流程继续执行",
    dedupeKey: `run-resumed:${stepId}`,
  });
  return true;
}
