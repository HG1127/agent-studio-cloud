"use server";

import { and, count, eq, isNotNull, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { MAX_EVALUATION_CASES, EvaluationCaseCreateInput } from "@/contracts/evaluation";
import {
  RunFeedbackSaveInput,
  RunFeedbackView,
  type RunFeedbackRegressionResult,
  type RunFeedbackSaveResult,
} from "@/contracts/run-feedback";
import { agents, auditEvents, evaluationCases, evaluationRuns, runFeedback, runs } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { auditEventValues } from "@/server/audit/event-values";
import { validationMessage } from "@/server/domain/validation-message";
import { redactCredentialData, redactCredentialText } from "@/server/domain/security/redact-sensitive";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { runFeedbackMatches } from "@/server/domain/run-feedback";

export async function saveRunFeedbackAction(input: unknown): Promise<RunFeedbackSaveResult> {
  const parsed = RunFeedbackSaveInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: validationMessage(parsed.error, "运行反馈填写不正确") };
  const storedNote = parsed.data.note ? redactCredentialText(parsed.data.note) : null;
  try {
    const outcome = await db.transaction(async (tx) => {
      const [run] = await tx.select({ id: runs.id, agentId: runs.agentId, status: runs.status })
        .from(runs)
        .where(and(eq(runs.id, parsed.data.runId), eq(runs.workspaceId, DEMO_WORKSPACE_ID)))
        .for("update")
        .limit(1);
      if (!run) return { kind: "missing" as const };
      if (run.status !== "completed") return { kind: "not-completed" as const };
      const [existing] = await tx.select()
        .from(runFeedback)
        .where(and(eq(runFeedback.runId, run.id), eq(runFeedback.workspaceId, DEMO_WORKSPACE_ID)))
        .limit(1);
      let saved = existing;
      if (!existing || !runFeedbackMatches(existing, { rating: parsed.data.rating, note: storedNote })) {
        const values = { rating: parsed.data.rating, note: storedNote, updatedAt: new Date() };
        [saved] = existing
          ? await tx.update(runFeedback).set(values).where(and(
              eq(runFeedback.id, existing.id), eq(runFeedback.workspaceId, DEMO_WORKSPACE_ID),
            )).returning()
          : await tx.insert(runFeedback).values({
              workspaceId: DEMO_WORKSPACE_ID,
              createdBy: DEMO_USER_ID,
              runId: run.id,
              agentId: run.agentId,
              ...values,
            }).returning();
        await tx.insert(auditEvents).values(auditEventValues({
          workspaceId: DEMO_WORKSPACE_ID,
          createdBy: DEMO_USER_ID,
          action: "run.feedback_saved",
          targetType: "run",
          targetId: run.id,
          summary: `${existing ? "更新" : "提交"}运行结果反馈：${parsed.data.rating === "useful" ? "有用" : "需要改进"}`,
          data: { rating: parsed.data.rating },
        }));
      }
      if (!saved) throw new Error("运行反馈写入后未返回记录");
      const [activeCase] = saved.evaluationCaseId
        ? await tx.select({ id: evaluationCases.id }).from(evaluationCases).where(and(
            eq(evaluationCases.id, saved.evaluationCaseId),
            eq(evaluationCases.agentId, saved.agentId),
            eq(evaluationCases.workspaceId, DEMO_WORKSPACE_ID),
            isNull(evaluationCases.archivedAt),
          )).limit(1)
        : [];
      const feedback = RunFeedbackView.parse({
        ...saved,
        evaluationCaseId: activeCase?.id ?? null,
        updatedAt: saved.updatedAt.toISOString(),
      });
      return { kind: "saved" as const, feedback };
    });
    if (outcome.kind === "missing") return { ok: false, error: "找不到这次运行，请刷新页面后重试" };
    if (outcome.kind === "not-completed") return { ok: false, error: "运行完成后才能评价结果" };
    try {
      revalidatePath(`/runs/${parsed.data.runId}`);
    } catch (error) {
      console.error("运行反馈已保存但页面刷新失败", safeErrorForLog(error));
    }
    return { ok: true, feedback: outcome.feedback };
  } catch (error) {
    console.error("保存运行反馈失败", safeErrorForLog(error));
    return { ok: false, error: "保存运行反馈失败，请稍后重试" };
  }
}

export async function createRegressionCaseFromRunFeedbackAction(runId: string): Promise<RunFeedbackRegressionResult> {
  if (!z.string().uuid().safeParse(runId).success) return { ok: false, error: "运行信息不正确，请刷新页面后重试" };
  try {
    const outcome = await db.transaction(async (tx) => {
      const [run] = await tx.select({ id: runs.id, agentId: runs.agentId, status: runs.status, input: runs.input })
        .from(runs)
        .where(and(eq(runs.id, runId), eq(runs.workspaceId, DEMO_WORKSPACE_ID)))
        .for("update")
        .limit(1);
      if (!run) return { kind: "missing" as const };
      if (run.status !== "completed") return { kind: "not-completed" as const };
      const [feedback] = await tx.select()
        .from(runFeedback)
        .where(and(eq(runFeedback.runId, run.id), eq(runFeedback.workspaceId, DEMO_WORKSPACE_ID)))
        .limit(1);
      if (!feedback || feedback.rating !== "needs_improvement") return { kind: "feedback-required" as const };
      const [agent] = await tx.select({ id: agents.id, name: agents.name, archivedAt: agents.archivedAt })
        .from(agents)
        .where(and(eq(agents.id, run.agentId), eq(agents.workspaceId, DEMO_WORKSPACE_ID)))
        .for("update")
        .limit(1);
      if (!agent) return { kind: "agent-missing" as const };
      const [linkedCase] = feedback.evaluationCaseId
        ? await tx.select({ id: evaluationCases.id, name: evaluationCases.name, archivedAt: evaluationCases.archivedAt })
            .from(evaluationCases)
            .where(and(
              eq(evaluationCases.id, feedback.evaluationCaseId),
              eq(evaluationCases.agentId, agent.id),
              eq(evaluationCases.workspaceId, DEMO_WORKSPACE_ID),
            )).limit(1)
        : [];
      if (linkedCase && !linkedCase.archivedAt) {
        return { kind: "created" as const, id: linkedCase.id, agentId: agent.id, created: false };
      }
      if (agent.archivedAt) return { kind: "agent-missing" as const };
      const [runningEvaluation] = await tx.select({ id: evaluationRuns.id }).from(evaluationRuns).where(and(
        eq(evaluationRuns.agentId, agent.id),
        eq(evaluationRuns.workspaceId, DEMO_WORKSPACE_ID),
        eq(evaluationRuns.status, "running"),
      )).limit(1);
      if (runningEvaluation) return { kind: "evaluation-running" as const };
      const [active] = await tx.select({ count: count() }).from(evaluationCases).where(and(
        eq(evaluationCases.agentId, agent.id),
        eq(evaluationCases.workspaceId, DEMO_WORKSPACE_ID),
        isNull(evaluationCases.archivedAt),
      ));
      if ((active?.count ?? 0) >= MAX_EVALUATION_CASES) return { kind: "limit" as const };
      if (linkedCase) {
        const [restored] = await tx.update(evaluationCases)
          .set({ archivedAt: null, updatedAt: new Date() })
          .where(and(
            eq(evaluationCases.id, linkedCase.id),
            eq(evaluationCases.workspaceId, DEMO_WORKSPACE_ID),
            eq(evaluationCases.agentId, agent.id),
            isNotNull(evaluationCases.archivedAt),
          ))
          .returning({ id: evaluationCases.id });
        if (!restored) return { kind: "changed" as const };
        await tx.insert(auditEvents).values(auditEventValues({
          workspaceId: DEMO_WORKSPACE_ID,
          createdBy: DEMO_USER_ID,
          action: "evaluation_case.restored",
          targetType: "evaluation",
          targetId: restored.id,
          summary: `恢复助手「${agent.name}」的验收样例「${linkedCase.name}」`,
          data: { sourceRunId: run.id },
        }));
        return { kind: "created" as const, id: restored.id, agentId: agent.id, created: true };
      }
      const name = `改进回归：${agent.name}`.slice(0, 80);
      const validCase = EvaluationCaseCreateInput.safeParse({
        agentId: agent.id,
        name,
        input: redactCredentialData(run.input),
        expectations: [],
      });
      if (!validCase.success) return { kind: "input-invalid" as const };
      const [created] = await tx.insert(evaluationCases).values({
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        agentId: agent.id,
        name,
        input: validCase.data.input,
        expectations: [],
      }).returning({ id: evaluationCases.id });
      await tx.update(runFeedback).set({ evaluationCaseId: created.id, updatedAt: new Date() }).where(and(
        eq(runFeedback.id, feedback.id), eq(runFeedback.workspaceId, DEMO_WORKSPACE_ID),
      ));
      await tx.insert(auditEvents).values(auditEventValues({
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        action: "run.feedback_regression_created",
        targetType: "run",
        targetId: run.id,
        summary: `把运行反馈加入助手「${agent.name}」的验收样例`,
        data: { evaluationCaseId: created.id, replacedEvaluationCaseId: feedback.evaluationCaseId },
      }));
      return { kind: "created" as const, id: created.id, agentId: agent.id, created: true };
    });
    if (outcome.kind === "missing") return { ok: false, error: "找不到这次运行，请刷新页面后重试" };
    if (outcome.kind === "not-completed") return { ok: false, error: "运行完成后才能加入验收样例" };
    if (outcome.kind === "feedback-required") return { ok: false, error: "请先提交需要改进的结果反馈" };
    if (outcome.kind === "agent-missing") return { ok: false, error: "这个助手已停用，无法新增验收样例" };
    if (outcome.kind === "evaluation-running") {
      return { ok: false, error: "自动验收运行期间不能新增回归样例，请等待验收完成" };
    }
    if (outcome.kind === "limit") return { ok: false, error: `启用中的验收样例已达到 ${MAX_EVALUATION_CASES} 条上限` };
    if (outcome.kind === "changed") return { ok: false, error: "验收样例状态已经变化，请刷新页面后重试" };
    if (outcome.kind === "input-invalid") return { ok: false, error: "这次运行的历史输入不符合当前验收格式，无法自动加入" };
    revalidatePath(`/runs/${runId}`);
    revalidatePath(`/agents/${outcome.agentId}`);
    revalidatePath("/memory");
    return { ok: true, evaluationCaseId: outcome.id, created: outcome.created };
  } catch (error) {
    console.error("从运行反馈创建验收样例失败", safeErrorForLog(error));
    return { ok: false, error: "加入验收样例失败，请稍后重试" };
  }
}
