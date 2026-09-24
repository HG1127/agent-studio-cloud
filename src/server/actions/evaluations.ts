"use server";

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  EvaluationCaseArchiveInput,
  EvaluationCaseCreateInput,
  EvaluationCaseUpdateInput,
  type EvaluationActionResult,
} from "@/contracts/evaluation";
import { agents, evaluationCaseResults, evaluationCases, evaluationRuns } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { markEvaluationStartFailure } from "@/server/services/evaluation-state";
import { prepareEvaluationRun } from "@/server/services/evaluation-start";
import { startRunCore } from "@/server/services/start-run-core";

export async function createEvaluationCaseAction(input: unknown): Promise<EvaluationActionResult> {
  const parsed = EvaluationCaseCreateInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "验收样例填写不完整，请检查后重试" };
  try {
    const result = await db.transaction(async (tx) => {
      const [agent] = await tx.select({ id: agents.id }).from(agents).where(and(
        eq(agents.id, parsed.data.agentId), eq(agents.workspaceId, DEMO_WORKSPACE_ID), isNull(agents.archivedAt),
      )).for("update").limit(1);
      if (!agent) return { ok: false as const, error: "找不到这个助手，请刷新页面后重试" };
      const [running] = await tx.select({ id: evaluationRuns.id }).from(evaluationRuns).where(and(
        eq(evaluationRuns.agentId, parsed.data.agentId),
        eq(evaluationRuns.workspaceId, DEMO_WORKSPACE_ID),
        eq(evaluationRuns.status, "running"),
      )).limit(1);
      if (running) return { ok: false as const, error: "自动验收运行期间不能修改验收样例" };
      await tx.insert(evaluationCases).values({
        workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, agentId: parsed.data.agentId,
        name: parsed.data.name, input: parsed.data.input, expectations: parsed.data.expectations,
      });
      return { ok: true as const };
    });
    if (!result.ok) return result;
    revalidatePath(`/agents/${parsed.data.agentId}`);
    return result;
  } catch (error) {
    console.error("创建验收样例失败", error);
    return { ok: false, error: "创建验收样例失败，请稍后重试" };
  }
}

export async function updateEvaluationCaseAction(input: unknown): Promise<EvaluationActionResult> {
  const parsed = EvaluationCaseUpdateInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "验收样例填写不完整，请检查后重试" };
  try {
    const rows = await db.transaction(async (tx) => {
      const [agent] = await tx.select({ id: agents.id }).from(agents).where(and(
        eq(agents.id, parsed.data.agentId), eq(agents.workspaceId, DEMO_WORKSPACE_ID), isNull(agents.archivedAt),
      )).for("update").limit(1);
      if (!agent) return null;
      const [running] = await tx.select({ id: evaluationRuns.id }).from(evaluationRuns).where(and(
        eq(evaluationRuns.agentId, parsed.data.agentId),
        eq(evaluationRuns.workspaceId, DEMO_WORKSPACE_ID),
        eq(evaluationRuns.status, "running"),
      )).limit(1);
      if (running) return "running" as const;
      return tx.update(evaluationCases).set({
        name: parsed.data.name, input: parsed.data.input,
        expectations: parsed.data.expectations, updatedAt: new Date(),
      }).where(and(
        eq(evaluationCases.id, parsed.data.caseId), eq(evaluationCases.agentId, parsed.data.agentId),
        eq(evaluationCases.workspaceId, DEMO_WORKSPACE_ID), isNull(evaluationCases.archivedAt),
      )).returning({ id: evaluationCases.id });
    });
    if (rows === "running") return { ok: false, error: "自动验收运行期间不能修改验收样例" };
    if (!rows) return { ok: false, error: "找不到这个助手，请刷新页面后重试" };
    if (rows.length === 0) return { ok: false, error: "找不到这条验收样例，请刷新页面后重试" };
    revalidatePath(`/agents/${parsed.data.agentId}`);
    return { ok: true };
  } catch (error) {
    console.error("更新验收样例失败", error);
    return { ok: false, error: "更新验收样例失败，请稍后重试" };
  }
}

export async function archiveEvaluationCaseAction(agentId: string, caseId: string): Promise<EvaluationActionResult> {
  return setEvaluationCaseArchivedAction({ agentId, caseId, archived: true });
}

export async function setEvaluationCaseArchivedAction(input: unknown): Promise<EvaluationActionResult> {
  const parsed = EvaluationCaseArchiveInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "验收样例信息不正确" };
  try {
    const updated = await db.transaction(async (tx) => {
      const [agent] = await tx.select({ id: agents.id }).from(agents).where(and(
        eq(agents.id, parsed.data.agentId), eq(agents.workspaceId, DEMO_WORKSPACE_ID), isNull(agents.archivedAt),
      )).for("update").limit(1);
      if (!agent) return null;
      const [running] = await tx.select({ id: evaluationRuns.id }).from(evaluationRuns).where(and(
        eq(evaluationRuns.agentId, parsed.data.agentId),
        eq(evaluationRuns.workspaceId, DEMO_WORKSPACE_ID),
        eq(evaluationRuns.status, "running"),
      )).limit(1);
      if (running) return "running" as const;
      return tx.update(evaluationCases)
        .set({ archivedAt: parsed.data.archived ? new Date() : null, updatedAt: new Date() })
        .where(and(
          eq(evaluationCases.id, parsed.data.caseId), eq(evaluationCases.agentId, parsed.data.agentId),
          eq(evaluationCases.workspaceId, DEMO_WORKSPACE_ID),
          parsed.data.archived ? isNull(evaluationCases.archivedAt) : isNotNull(evaluationCases.archivedAt),
        ))
        .returning({ id: evaluationCases.id });
    });
    if (updated === "running") return { ok: false, error: "自动验收运行期间不能修改验收样例" };
    if (!updated) return { ok: false, error: "找不到这个助手，请刷新页面后重试" };
    if (updated.length === 0) return { ok: false, error: "验收样例状态已经变化，请刷新页面后重试" };
    revalidatePath(`/agents/${parsed.data.agentId}`);
    return { ok: true };
  } catch (error) {
    console.error("更新验收样例状态失败", error);
    return { ok: false, error: "更新验收样例状态失败，请稍后重试" };
  }
}

export async function startEvaluationAction(agentId: string): Promise<EvaluationActionResult> {
  if (!z.string().uuid().safeParse(agentId).success) return { ok: false, error: "助手信息不正确" };
  try {
    const prepared = await prepareEvaluationRun(agentId);
    if (!prepared.ok) return prepared;
    for (const testCase of prepared.cases) {
      const started = await startRunCore({
        agentId,
        versionId: prepared.versionId,
        input: testCase.input,
        sourceType: "evaluation",
        sourceKey: `evaluation:${prepared.evaluationId}:${testCase.id}`,
      });
      if (started.ok) {
        await db
          .update(evaluationCaseResults)
          .set({ runId: started.runId, updatedAt: new Date() })
          .where(and(
            eq(evaluationCaseResults.evaluationRunId, prepared.evaluationId),
            eq(evaluationCaseResults.evaluationCaseId, testCase.id),
          ));
      } else {
        await markEvaluationStartFailure(prepared.evaluationId, testCase.id, started.error);
      }
    }
    revalidatePath(`/agents/${agentId}`);
    revalidatePath("/runs");
    return { ok: true };
  } catch (error) {
    console.error("启动自动验收失败", error);
    return { ok: false, error: "启动自动验收失败，请稍后重试" };
  }
}
