"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { resumeHook } from "workflow/api";
import { ApprovalDecisionInput, type ApprovalDecisionResult } from "@/contracts/run";
import { approvals, runs } from "@/db/schema";
import { db } from "@/lib/db";

// 人工审批决定入口：先做从属与状态校验（防跨 run 审批、防重复决定），再落行并恢复工作流。
// token 由 runId + nodeId 按服务端约定重建，不经过前端。
export async function decideApprovalAction(
  runId: string,
  approvalId: string,
  input: ApprovalDecisionInput,
): Promise<ApprovalDecisionResult> {
  const parsedInput = ApprovalDecisionInput.safeParse(input);
  const uuid = z.string().uuid();
  if (!uuid.safeParse(runId).success || !uuid.safeParse(approvalId).success || !parsedInput.success) {
    return { ok: false, error: "审批参数不正确，请刷新页面后重试" };
  }
  try {
    const [row] = await db
      .select()
      .from(approvals)
      .where(and(eq(approvals.id, approvalId), eq(approvals.runId, runId)))
      .limit(1);
    if (!row) {
      return { ok: false, error: "找不到这条确认记录，请刷新页面后重试" };
    }
    const [run] = await db
      .select({ agentId: runs.agentId })
      .from(runs)
      .where(eq(runs.id, runId))
      .limit(1);
    if (!run) {
      return { ok: false, error: "找不到这次运行，请刷新页面后重试" };
    }
    if (row.status !== "pending") {
      return { ok: false, error: "这条确认已经处理过，请勿重复提交" };
    }
    const approved = parsedInput.data.decision === "approved";
    const note = parsedInput.data.note?.trim() ? parsedInput.data.note.trim() : null;
    const now = new Date();
    await db
      .update(approvals)
      .set({
        status: approved ? "approved" : "rejected",
        note,
        decidedAt: now,
        updatedAt: now,
      })
      .where(eq(approvals.id, approvalId));
    await resumeHook(`approval:${runId}:${row.nodeId}`, {
      decision: parsedInput.data.decision,
      note: note ?? undefined,
    });
    revalidatePath(`/agents/${run.agentId}`);
    revalidatePath("/agents");
    return { ok: true };
  } catch (error) {
    console.error("提交确认失败", error);
    return { ok: false, error: "提交确认失败，请稍后重试" };
  }
}
