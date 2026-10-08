import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { resumeHook } from "workflow/api";
import { ApprovalDecisionInput, ApprovalPayload, RunStatus, type ApprovalDecisionResult } from "@/contracts/run";
import { approvals, runs, traceEvents } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { redactCredentialText } from "@/server/domain/security/redact-sensitive";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { revalidatePathsAfterCommit } from "@/server/actions/revalidate-paths";
import { approvalDecisionPolicy, normalizeApprovalNote } from "@/server/domain/approval/decision-policy";

// 人工审批决定入口：原子条件更新抢占 pending 行（并发下只有一次提交生效），再恢复工作流；
// 恢复结果不确定时保留确认决定，由页面提供显式继续入口。token 由确认记录 ID 按服务端约定重建，不经过前端。
export async function decideApprovalCore(
  runId: string,
  approvalId: string,
  input: ApprovalDecisionInput,
  idempotent = false,
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
    if (idempotent && row.status !== "pending") return await reconcileApprovalDecision(runId, approvalId, parsedInput.data);
    if (run.status !== "waiting_approval") {
      return { ok: false, error: "这次运行已不再等待确认，请刷新页面查看最新状态" };
    }
    if (idempotent && !ApprovalPayload.safeParse(row.payload ?? { review: null }).success) {
      return { ok: false, error: "确认内容无法安全读取，不能提交决定" };
    }
    if (parsedInput.data.resumeOnly || row.status !== "pending") {
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
      revalidatePathsAfterCommit([`/runs/${runId}`, "/runs", "/", `/agents/${run.agentId}`, "/agents"], "approval-resume");
      return { ok: true };
    }
    const approved = parsedInput.data.decision === "approved";
    const note = parsedInput.data.note?.trim() ? redactCredentialText(parsedInput.data.note.trim()) : null;
    const now = new Date();
    let decidedNote = note;
    let claimed: { id: string }[] | null;
    try {
      claimed = await db.transaction(async (tx) => {
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
    } catch (transactionError) {
      if (idempotent) return await reconcileApprovalDecision(runId, approvalId, parsedInput.data);
      let saved: { status: string; note: string | null } | undefined;
      try {
        [saved] = await db
          .select({ status: approvals.status, note: approvals.note })
          .from(approvals)
          .where(and(eq(approvals.id, approvalId), eq(approvals.runId, runId), eq(approvals.workspaceId, DEMO_WORKSPACE_ID)))
          .limit(1);
      } catch (recoveryError) {
        console.error("核对确认提交结果失败", safeErrorForLog(recoveryError));
        throw transactionError;
      }
      if (saved?.status !== parsedInput.data.decision) throw transactionError;
      claimed = [{ id: approvalId }];
      decidedNote = saved.note ? redactCredentialText(saved.note) : null;
    }
    if (claimed === null) {
      if (idempotent) return await reconcileApprovalDecision(runId, approvalId, parsedInput.data);
      return { ok: false, error: "这次运行已不再等待确认，请刷新页面查看最新状态" };
    }
    if (claimed.length === 0) {
      if (idempotent) return await reconcileApprovalDecision(runId, approvalId, parsedInput.data);
      return { ok: false, error: "这条确认已经处理过，请勿重复提交" };
    }
    if (idempotent) return await reconcileApprovalDecision(runId, approvalId, parsedInput.data);
    try {
      await resumeHook(`approval:${row.id}`, {
        decision: parsedInput.data.decision,
        note: decidedNote ?? undefined,
      });
    } catch (error) {
      // resumeHook 可能已被执行引擎接收，只是响应在网络中丢失；回滚会让数据库与运行状态互相矛盾。
      console.error("恢复工作流失败，确认决定已保留", safeErrorForLog(error));
      revalidatePathsAfterCommit([`/runs/${runId}`, "/runs"], "approval-resume-failed");
      return { ok: false, error: "确认已保留，但运行暂时无法继续，请稍后重试", saved: true };
    }
    revalidatePathsAfterCommit([`/runs/${runId}`, "/runs", "/", `/agents/${run.agentId}`, "/agents"], "approval-decide");
    return { ok: true };
  } catch (error) {
    console.error("提交确认失败", safeErrorForLog(error));
    return { ok: false, error: "提交确认失败，请稍后重试", ...(idempotent ? { retryable: true as const } : {}) };
  }
}

async function readDecisionState(runId: string, approvalId: string, request: ApprovalDecisionInput) {
  const [row] = await db.select({ status: approvals.status, note: approvals.note }).from(approvals).where(and(
    eq(approvals.id, approvalId), eq(approvals.runId, runId), eq(approvals.workspaceId, DEMO_WORKSPACE_ID),
  )).limit(1);
  const [run] = await db.select({ agentId: runs.agentId, status: runs.status }).from(runs).where(and(eq(runs.id, runId), eq(runs.workspaceId, DEMO_WORKSPACE_ID))).limit(1);
  if (!row || !run) return null;
  const runStatus = RunStatus.parse(run.status);
  const [consumed] = row.status === "pending" ? [] : await db.select({ id: traceEvents.id }).from(traceEvents).where(and(
    eq(traceEvents.runId, runId), eq(traceEvents.workspaceId, DEMO_WORKSPACE_ID), eq(traceEvents.kind, "approval.decided"),
    sql`${traceEvents.data} ->> '_dedupeKey' = ${`approval-decided:${approvalId}:${row.status}`}`,
  )).limit(1);
  return { row, run, policy: approvalDecisionPolicy({ ...row, runStatus, consumed: Boolean(consumed), request }) };
}

async function reconcileApprovalDecision(runId: string, approvalId: string, input: ApprovalDecisionInput): Promise<ApprovalDecisionResult> {
  const state = await readDecisionState(runId, approvalId, input);
  if (!state) return { ok: false, error: "确认记录不存在或不可访问" };
  if (state.policy === "conflict") return { ok: false, error: "确认决定或备注已改变，请沿用原请求核对" };
  if (state.policy === "unavailable") return { ok: false, error: "这次运行已不再等待此项确认，不再恢复执行" };
  if (state.policy === "decide") return { ok: false, error: "确认提交结果暂时无法确认，请按原请求重试", retryable: true };
  if (state.policy === "resume") {
    try {
      await resumeHook(`approval:${approvalId}`, { decision: input.decision, note: normalizeApprovalNote(state.row.note) ?? undefined });
    } catch (error) {
      console.error("程序化确认恢复结果待核对", safeErrorForLog(error));
      // 原钩子可能已消费且运行又等待另一项确认，必须核对这条确认的消费轨迹。
      try {
        const latest = await readDecisionState(runId, approvalId, input);
        if (latest?.policy === "accepted") {
          revalidatePathsAfterCommit([`/runs/${runId}`, "/runs"], "approval-task-reconciled");
          return { ok: true };
        }
        if (latest?.policy === "conflict" || latest?.policy === "unavailable") return { ok: false, error: "决定已保留，当前运行不能继续恢复此项确认", saved: true };
      } catch (recoveryError) {
        console.error("核对程序化确认恢复失败", safeErrorForLog(recoveryError));
      }
      revalidatePathsAfterCommit([`/runs/${runId}`, "/runs"], "approval-task-resume-failed");
      return { ok: false, error: "确认已保留，但运行暂时无法继续，请沿用原请求重试", saved: true, retryable: true };
    }
  }
  revalidatePathsAfterCommit([`/runs/${runId}`, "/runs", "/", `/agents/${state.run.agentId}`, "/agents"], "approval-task-decide");
  return { ok: true };
}
