"use server";

import { and, eq, inArray, like, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getRun } from "workflow/api";
import { z } from "zod";
import type { CancelRunResult } from "@/contracts/run";
import { approvals, runs } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { completeEvaluationForRun } from "@/server/services/evaluation-state";

const LIVE_STATUSES = ["queued", "running", "waiting_approval", "waiting_event"];

export async function cancelRunAction(runId: string): Promise<CancelRunResult> {
  if (!z.string().uuid().safeParse(runId).success) return { ok: false, error: "运行信息不正确，请刷新页面后重试" };
  try {
    const [run] = await db
      .select({ status: runs.status, workflowRunId: runs.workflowRunId })
      .from(runs)
      .where(and(eq(runs.id, runId), eq(runs.workspaceId, DEMO_WORKSPACE_ID)))
      .limit(1);
    if (!run) return { ok: false, error: "找不到这次运行" };
    if (!LIVE_STATUSES.includes(run.status)) return { ok: false, error: "这次运行已经结束，无法取消" };
    if (!run.workflowRunId) return { ok: false, error: "运行尚未完成启动，请稍后再试" };

    await getRun(run.workflowRunId).cancel();
    const now = new Date();
    const updated = await db.transaction(async (tx) => {
      const rows = await tx
        .update(runs)
        .set({ status: "cancelled", error: "已由员工取消", finishedAt: now, updatedAt: now })
        .where(and(eq(runs.id, runId), inArray(runs.status, LIVE_STATUSES)))
        .returning({ id: runs.id });
      if (rows.length > 0) {
        const descendantIds: string[] = [];
        let parents = [runId];
        for (let depth = 0; depth < 3 && parents.length > 0; depth += 1) {
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
            .where(and(inArray(runs.id, descendantIds), inArray(runs.status, LIVE_STATUSES)));
        }
        await tx
          .update(approvals)
          .set({ status: "rejected", note: "运行已取消，确认未继续", decidedAt: now, updatedAt: now })
          .where(
            and(
              inArray(approvals.runId, [runId, ...descendantIds]),
              eq(approvals.workspaceId, DEMO_WORKSPACE_ID),
              eq(approvals.status, "pending"),
            ),
          );
      }
      return rows;
    });
    if (updated.length === 0) return { ok: false, error: "运行已在取消前结束，请刷新页面查看结果" };
    await completeEvaluationForRun(runId, null, "运行已取消");
    revalidatePath(`/runs/${runId}`);
    revalidatePath("/runs");
    return { ok: true };
  } catch (error) {
    console.error("取消运行失败：", error);
    return { ok: false, error: "取消失败，请稍后重试" };
  }
}
