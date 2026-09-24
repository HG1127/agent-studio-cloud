"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getRun } from "workflow/api";
import { z } from "zod";
import type { CancelRunResult } from "@/contracts/run";
import { runs } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { completeEvaluationForRun } from "@/server/services/evaluation-state";

const LIVE_STATUSES = ["queued", "running", "waiting_approval", "waiting_event"];

export async function cancelRunAction(runId: string): Promise<CancelRunResult> {
  if (!z.string().uuid().safeParse(runId).success) return { ok: false, error: "运行信息不正确，请刷新页面后重试" };
  const [run] = await db
    .select({ status: runs.status, workflowRunId: runs.workflowRunId })
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.workspaceId, DEMO_WORKSPACE_ID)))
    .limit(1);
  if (!run) return { ok: false, error: "找不到这次运行" };
  if (!LIVE_STATUSES.includes(run.status)) return { ok: false, error: "这次运行已经结束，无法取消" };
  if (!run.workflowRunId) return { ok: false, error: "运行尚未完成启动，请稍后再试" };
  try {
    await getRun(run.workflowRunId).cancel();
    const updated = await db
      .update(runs)
      .set({ status: "cancelled", error: "已由员工取消", finishedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(runs.id, runId), inArray(runs.status, LIVE_STATUSES)))
      .returning({ id: runs.id });
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
