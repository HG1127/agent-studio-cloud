"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { resumeHook } from "workflow/api";
import { ApprovalDecisionInput, type ApprovalDecisionResult } from "@/contracts/run";
import { approvals, runs } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { redactCredentialText } from "@/server/domain/security/redact-sensitive";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";

// 人工审批决定入口：原子条件更新抢占 pending 行（并发下只有一次提交生效），再恢复工作流；
// 恢复结果不确定时保留确认决定，由页面提供显式继续入口。token 由确认记录 ID 按服务端约定重建，不经过前端。
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
      .where(and(eq(approvals.id, approvalId), eq(approvals.runId, runId), eq(approvals.workspaceId, DEMO_WORKSPACE_ID)))
      .limit(1);
    if (!row) {
      return { ok: false, error: "找不到这条确认记录，请刷新页面后重试" };
    }
    const [run] = await db
      .select({ agentId: runs.agentId, status: runs.status })
      .from(runs)
      .where(and(eq(runs.id, runId), eq(runs.workspaceId, DEMO_WORKSPACE_ID)))
      .limit(1);
    if (!run) {
      return { ok: false, error: "找不到这次运行，请刷新页面后重试" };
    }
    if (run.status !== "waiting_approval") {
      return { ok: false, error: "这次运行已不再等待确认，请刷新页面查看最新状态" };
    }
    if (parsedInput.data.resumeOnly) {
      if (row.status === "pending" || row.status !== parsedInput.data.decision) {
        return { ok: false, error: "确认记录与继续请求不一致，请刷新页面后重试" };
      }
      try {
        await resumeHook(`approval:${row.id}`, {
          decision: row.status,
          note: row.note ? redactCredentialText(row.note) : undefined,
        });
      } catch (error) {
        console.error("继续已确认的工作流失败", safeErrorForLog(error));
        return { ok: false, error: "确认已保留，但运行暂时无法继续，请稍后重试", saved: true };
      }
      revalidatePath(`/runs/${runId}`);
      revalidatePath("/runs");
      revalidatePath("/");
      revalidatePath(`/agents/${run.agentId}`);
      revalidatePath("/agents");
      return { ok: true };
    }
    const approved = parsedInput.data.decision === "approved";
    const note = parsedInput.data.note?.trim() ? redactCredentialText(parsedInput.data.note.trim()) : null;
    const now = new Date();
    const claimed = await db.transaction(async (tx) => {
      const [lockedRun] = await tx
        .select({ status: runs.status })
        .from(runs)
        .where(and(eq(runs.id, runId), eq(runs.workspaceId, DEMO_WORKSPACE_ID)))
        .for("update")
        .limit(1);
      if (lockedRun?.status !== "waiting_approval") return null;
      return tx
        .update(approvals)
        .set({ status: approved ? "approved" : "rejected", note, decidedAt: now, updatedAt: now })
        .where(and(
          eq(approvals.id, approvalId),
          eq(approvals.runId, runId),
          eq(approvals.workspaceId, DEMO_WORKSPACE_ID),
          eq(approvals.status, "pending"),
        ))
        .returning({ id: approvals.id });
    });
    if (claimed === null) {
      return { ok: false, error: "这次运行已不再等待确认，请刷新页面查看最新状态" };
    }
    if (claimed.length === 0) {
      return { ok: false, error: "这条确认已经处理过，请勿重复提交" };
    }
    try {
      await resumeHook(`approval:${row.id}`, {
        decision: parsedInput.data.decision,
        note: note ?? undefined,
      });
    } catch (error) {
      // resumeHook 可能已被执行引擎接收，只是响应在网络中丢失；回滚会让数据库与运行状态互相矛盾。
      console.error("恢复工作流失败，确认决定已保留", safeErrorForLog(error));
      revalidatePath(`/runs/${runId}`);
      revalidatePath("/runs");
      return { ok: false, error: "确认已保留，但运行暂时无法继续，请稍后重试", saved: true };
    }
    revalidatePath(`/runs/${runId}`);
    revalidatePath("/runs");
    revalidatePath("/");
    revalidatePath(`/agents/${run.agentId}`);
    revalidatePath("/agents");
    return { ok: true };
  } catch (error) {
    console.error("提交确认失败", safeErrorForLog(error));
    return { ok: false, error: "提交确认失败，请稍后重试" };
  }
}
