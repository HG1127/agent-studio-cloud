"use server";

import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { CancelRunResult } from "@/contracts/run";
import { approvals, runs } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { completeEvaluationForRun, reconcileTerminalEvaluationRun } from "@/server/services/evaluation-state";
import { MAX_COLLABORATION_DEPTH, parseCollaborationParentId } from "@/server/domain/runtime/collaboration-chain";
import { isRunStartLeaseExpired, RUN_START_LEASE_KEY } from "@/server/services/run-start-lease";
import { cancelWorkflowRunIfPresent } from "@/server/services/cancel-workflow-run";
import { appendTrace } from "@/server/steps/trace-step";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { revalidatePathsAfterCommit } from "@/server/actions/revalidate-paths";

const LIVE_STATUSES = ["queued", "running", "waiting_approval", "waiting_event"];

async function cancelWorkflowRunsBestEffort(workflowRunIds: ReadonlyArray<string>): Promise<void> {
  const uniqueIds = [...new Set(workflowRunIds)];
  const outcomes = await Promise.allSettled(uniqueIds.map((workflowRunId) => cancelWorkflowRunIfPresent(workflowRunId)));
  for (const [index, outcome] of outcomes.entries()) {
    if (outcome.status === "rejected") {
      console.error(`停止工作流 ${uniqueIds[index]} 失败，运行终态已保留：`, safeErrorForLog(outcome.reason));
    }
  }
}

async function recoverCancelledCollaboration(runId: string): Promise<string> {
  let rootRunId = runId;
  const [initial] = await db
    .select({ sourceType: runs.sourceType, sourceKey: runs.sourceKey, workflowRunId: runs.workflowRunId })
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.workspaceId, DEMO_WORKSPACE_ID), eq(runs.status, "cancelled")))
    .limit(1);
  if (!initial) return runId;
  let root = initial;
  for (let depth = 0; depth < MAX_COLLABORATION_DEPTH; depth += 1) {
    const parentId = parseCollaborationParentId(root);
    if (!parentId) break;
    const [parent] = await db
      .select({ sourceType: runs.sourceType, sourceKey: runs.sourceKey, workflowRunId: runs.workflowRunId })
      .from(runs)
      .where(and(eq(runs.id, parentId), eq(runs.workspaceId, DEMO_WORKSPACE_ID), eq(runs.status, "cancelled")))
      .limit(1);
    if (!parent) break;
    rootRunId = parentId;
    root = parent;
  }

  const workflowRunIds = root.workflowRunId ? [root.workflowRunId] : [];
  const seen = new Set([rootRunId]);
  let parents = [rootRunId];
  for (let depth = 0; depth < MAX_COLLABORATION_DEPTH && parents.length > 0; depth += 1) {
    const children = await db
      .select({ id: runs.id, status: runs.status, workflowRunId: runs.workflowRunId })
      .from(runs)
      .where(and(
        eq(runs.workspaceId, DEMO_WORKSPACE_ID),
        or(...parents.flatMap((parentId) => [
          like(runs.sourceKey, `agent-call:${parentId}:%`),
          like(runs.sourceKey, `handoff:${parentId}:%`),
        ])),
      ));
    const fresh = children.filter((child) => !seen.has(child.id));
    fresh.forEach((child) => seen.add(child.id));
    parents = fresh.map((child) => child.id);
    workflowRunIds.push(...fresh
      .filter((child) => child.status === "cancelled")
      .map((child) => child.workflowRunId)
      .filter((id): id is string => Boolean(id)));
  }
  await cancelWorkflowRunsBestEffort(workflowRunIds);
  return rootRunId;
}

export async function cancelRunAction(runId: string): Promise<CancelRunResult> {
  if (!z.string().uuid().safeParse(runId).success) return { ok: false, error: "运行信息不正确，请刷新页面后重试" };
  try {
    const [run] = await db
      .select({
        status: runs.status,
        workflowRunId: runs.workflowRunId,
        sourceType: runs.sourceType,
        sourceKey: runs.sourceKey,
        stepStates: runs.stepStates,
        updatedAt: runs.updatedAt,
      })
      .from(runs)
      .where(and(eq(runs.id, runId), eq(runs.workspaceId, DEMO_WORKSPACE_ID)))
      .limit(1);
    if (!run) return { ok: false, error: "找不到这次运行" };
    if (run.status === "cancelled") {
      // 首次请求可能已写入取消终态、但执行引擎停止或验收汇总失败；重复请求负责补偿。
      const rootRunId = await recoverCancelledCollaboration(runId);
      await appendCancellationTrace(rootRunId);
      await reconcileTerminalEvaluationRun(rootRunId);
      revalidatePathsAfterCommit([
        `/runs/${runId}`,
        ...(rootRunId !== runId ? [`/runs/${rootRunId}`] : []),
        "/runs",
      ], "run-cancel-resume");
      return { ok: true };
    }
    if (!LIVE_STATUSES.includes(run.status)) return { ok: false, error: "这次运行已经结束，无法取消" };
    let rootRunId = runId;
    let root = run;
    for (let depth = 0; depth < MAX_COLLABORATION_DEPTH; depth += 1) {
      if (!root.sourceKey || !["agent_call", "handoff"].includes(root.sourceType)) break;
      const parentId = parseCollaborationParentId(root);
      if (!parentId) break;
      const [parent] = await db
        .select({
          status: runs.status,
          workflowRunId: runs.workflowRunId,
          sourceType: runs.sourceType,
          sourceKey: runs.sourceKey,
          stepStates: runs.stepStates,
          updatedAt: runs.updatedAt,
        })
        .from(runs)
        .where(and(eq(runs.id, parentId), eq(runs.workspaceId, DEMO_WORKSPACE_ID)))
        .limit(1);
      if (!parent) return { ok: false, error: "找不到这次协作运行的上级任务，请刷新页面后重试" };
      if (!LIVE_STATUSES.includes(parent.status)) break;
      rootRunId = parentId;
      root = parent;
    }
    const orphanedWorkflow = !root.workflowRunId
      && isRunStartLeaseExpired(root.stepStates, root.updatedAt);
    if (!root.workflowRunId && !orphanedWorkflow) return { ok: false, error: "运行尚未完成启动，请稍后再试", retryable: true };

    const now = new Date();
    const outcome = await db.transaction(async (tx) => {
      const rows = await tx
        .update(runs)
        .set({
          status: "cancelled",
          error: "已由员工取消",
          stepStates: sql`${runs.stepStates} - ${RUN_START_LEASE_KEY}`,
          finishedAt: now,
          updatedAt: now,
        })
        .where(and(
          eq(runs.id, rootRunId),
          eq(runs.workspaceId, DEMO_WORKSPACE_ID),
          inArray(runs.status, LIVE_STATUSES),
        ))
        .returning({ id: runs.id });
      if (rows.length > 0) {
        const descendantIds: string[] = [];
        const descendantWorkflowRunIds: string[] = [];
        const seen = new Set([rootRunId]);
        let parents = [rootRunId];
        for (let depth = 0; depth < MAX_COLLABORATION_DEPTH && parents.length > 0; depth += 1) {
          const children = await tx
            .select({ id: runs.id, workflowRunId: runs.workflowRunId, status: runs.status })
            .from(runs)
            .where(and(
              eq(runs.workspaceId, DEMO_WORKSPACE_ID),
              or(...parents.flatMap((parentId) => [
                like(runs.sourceKey, `agent-call:${parentId}:%`),
                like(runs.sourceKey, `handoff:${parentId}:%`),
              ])),
            ));
          const fresh = children.filter((child) => !seen.has(child.id));
          fresh.forEach((child) => seen.add(child.id));
          parents = fresh.map((child) => child.id);
          descendantIds.push(...fresh.map((child) => child.id));
          descendantWorkflowRunIds.push(...fresh
            .filter((child) => LIVE_STATUSES.includes(child.status))
            .map((child) => child.workflowRunId)
            .filter((id): id is string => Boolean(id)));
        }
        if (descendantIds.length > 0) {
          await tx
            .update(runs)
            .set({ status: "cancelled", error: "上级运行已取消", finishedAt: now, updatedAt: now })
            .where(and(
              inArray(runs.id, descendantIds),
              eq(runs.workspaceId, DEMO_WORKSPACE_ID),
              inArray(runs.status, LIVE_STATUSES),
            ));
        }
        await tx
          .update(approvals)
          .set({ status: "rejected", note: "运行已取消，确认未继续", decidedAt: now, updatedAt: now })
          .where(
            and(
              inArray(approvals.runId, [rootRunId, ...descendantIds]),
              eq(approvals.workspaceId, DEMO_WORKSPACE_ID),
              eq(approvals.status, "pending"),
            ),
          );
        return { rows, descendantWorkflowRunIds };
      }
      return { rows, descendantWorkflowRunIds: [] as string[] };
    });
    if (outcome.rows.length === 0) {
      const [current] = await db
        .select({ status: runs.status })
        .from(runs)
        .where(and(eq(runs.id, rootRunId), eq(runs.workspaceId, DEMO_WORKSPACE_ID)))
        .limit(1);
      if (current?.status !== "cancelled") return { ok: false, error: "运行已在取消前结束，请刷新页面查看结果" };
      const recoveredRootRunId = await recoverCancelledCollaboration(rootRunId);
      await appendCancellationTrace(recoveredRootRunId);
      await reconcileTerminalEvaluationRun(recoveredRootRunId);
      revalidatePathsAfterCommit([
        `/runs/${runId}`,
        ...(recoveredRootRunId !== runId ? [`/runs/${recoveredRootRunId}`] : []),
        "/runs",
      ], "run-cancel-recover");
      return { ok: true };
    }
    // 先提交数据库终态，再停止执行引擎。即使平台取消接口瞬时失败，后续步骤也会被终态守卫拒绝，
    // 不会留下“引擎已停、数据库仍显示运行中”的永久卡死记录。
    await cancelWorkflowRunsBestEffort([
      ...(root.workflowRunId ? [root.workflowRunId] : []),
      ...outcome.descendantWorkflowRunIds,
    ]);
    await appendCancellationTrace(rootRunId);
    await completeEvaluationForRun(rootRunId, null, "运行已取消");
    revalidatePathsAfterCommit([
      `/runs/${runId}`,
      ...(rootRunId !== runId ? [`/runs/${rootRunId}`] : []),
      "/runs",
    ], "run-cancel");
    return { ok: true };
  } catch (error) {
    console.error("取消运行失败：", safeErrorForLog(error));
    return { ok: false, error: "取消失败，请稍后重试", retryable: true };
  }
}

async function appendCancellationTrace(runId: string): Promise<void> {
  try {
    await appendTrace({
      runId,
      kind: "run.cancelled",
      level: "warn",
      title: "运行已取消",
      detail: "员工手动取消了这次运行",
    });
  } catch (traceError) {
    // 取消终态已经提交；轨迹故障不能把成功取消误报成失败。
    console.error("记录取消轨迹失败：", safeErrorForLog(traceError));
  }
}
