"use server";

import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
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

const LIVE_STATUSES = ["queued", "running", "waiting_approval", "waiting_event"];

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
      // 首次请求可能已写入取消终态、但在验收汇总时失败；重复请求负责把对账补齐。
      await reconcileTerminalEvaluationRun(runId);
      revalidatePath(`/runs/${runId}`);
      revalidatePath("/runs");
      return { ok: true };
    }
    if (!LIVE_STATUSES.includes(run.status)) return { ok: false, error: "这次运行已经结束，无法取消" };
    let rootRunId = runId;
    let root = run;
    for (let depth = 0; depth < MAX_COLLABORATION_DEPTH && !root.workflowRunId; depth += 1) {
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
    if (!root.workflowRunId && !orphanedWorkflow) return { ok: false, error: "运行尚未完成启动，请稍后再试" };

    if (root.workflowRunId) await cancelWorkflowRunIfPresent(root.workflowRunId);
    const now = new Date();
    const updated = await db.transaction(async (tx) => {
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
        let parents = [rootRunId];
        for (let depth = 0; depth < MAX_COLLABORATION_DEPTH && parents.length > 0; depth += 1) {
          const children = await tx
            .select({ id: runs.id })
            .from(runs)
            .where(and(
              eq(runs.workspaceId, DEMO_WORKSPACE_ID),
              or(...parents.flatMap((parentId) => [
                like(runs.sourceKey, `agent-call:${parentId}:%`),
                like(runs.sourceKey, `handoff:${parentId}:%`),
              ])),
            ));
          parents = children.map((child) => child.id).filter((id) => !descendantIds.includes(id));
          descendantIds.push(...parents);
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
      }
      return rows;
    });
    if (updated.length === 0) {
      const [current] = await db
        .select({ status: runs.status })
        .from(runs)
        .where(and(eq(runs.id, rootRunId), eq(runs.workspaceId, DEMO_WORKSPACE_ID)))
        .limit(1);
      if (current?.status !== "cancelled") return { ok: false, error: "运行已在取消前结束，请刷新页面查看结果" };
      await reconcileTerminalEvaluationRun(rootRunId);
      revalidatePath(`/runs/${runId}`);
      if (rootRunId !== runId) revalidatePath(`/runs/${rootRunId}`);
      revalidatePath("/runs");
      return { ok: true };
    }
    try {
      await appendTrace({
        runId: rootRunId,
        kind: "run.cancelled",
        level: "warn",
        title: "运行已取消",
        detail: "员工手动取消了这次运行",
      });
    } catch (traceError) {
      // 取消终态已经提交；轨迹故障不能把成功取消误报成失败。
      console.error("记录取消轨迹失败：", traceError);
    }
    await completeEvaluationForRun(rootRunId, null, "运行已取消");
    revalidatePath(`/runs/${runId}`);
    if (rootRunId !== runId) revalidatePath(`/runs/${rootRunId}`);
    revalidatePath("/runs");
    return { ok: true };
  } catch (error) {
    console.error("取消运行失败：", error);
    return { ok: false, error: "取消失败，请稍后重试" };
  }
}
