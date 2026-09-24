"use server";

import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  EvaluationCaseArchiveInput,
  EvaluationCaseCreateInput,
  EvaluationCaseUpdateInput,
  type EvaluationActionResult,
} from "@/contracts/evaluation";
import { agentVersions, agents, evaluationCaseResults, evaluationCases, evaluationRuns } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { markEvaluationStartFailure } from "@/server/services/evaluation-state";
import { startRunCore } from "@/server/services/start-run-core";

export async function createEvaluationCaseAction(input: unknown): Promise<EvaluationActionResult> {
  const parsed = EvaluationCaseCreateInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "验收样例填写不完整，请检查后重试" };
  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.id, parsed.data.agentId), eq(agents.workspaceId, DEMO_WORKSPACE_ID), isNull(agents.archivedAt)))
    .limit(1);
  if (!agent) return { ok: false, error: "找不到这个助手，请刷新页面后重试" };
  await db.insert(evaluationCases).values({
    workspaceId: DEMO_WORKSPACE_ID,
    createdBy: DEMO_USER_ID,
    agentId: parsed.data.agentId,
    name: parsed.data.name,
    input: parsed.data.input,
    expectations: parsed.data.expectations,
  });
  revalidatePath(`/agents/${parsed.data.agentId}`);
  return { ok: true };
}

export async function updateEvaluationCaseAction(input: unknown): Promise<EvaluationActionResult> {
  const parsed = EvaluationCaseUpdateInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "验收样例填写不完整，请检查后重试" };
  try {
    const rows = await db
      .update(evaluationCases)
      .set({
        name: parsed.data.name,
        input: parsed.data.input,
        expectations: parsed.data.expectations,
        updatedAt: new Date(),
      })
      .where(and(
        eq(evaluationCases.id, parsed.data.caseId),
        eq(evaluationCases.agentId, parsed.data.agentId),
        eq(evaluationCases.workspaceId, DEMO_WORKSPACE_ID),
        isNull(evaluationCases.archivedAt),
      ))
      .returning({ id: evaluationCases.id });
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
    const updated = await db
      .update(evaluationCases)
      .set({ archivedAt: parsed.data.archived ? new Date() : null, updatedAt: new Date() })
      .where(and(
        eq(evaluationCases.id, parsed.data.caseId),
        eq(evaluationCases.agentId, parsed.data.agentId),
        eq(evaluationCases.workspaceId, DEMO_WORKSPACE_ID),
        parsed.data.archived ? isNull(evaluationCases.archivedAt) : isNotNull(evaluationCases.archivedAt),
      ))
      .returning({ id: evaluationCases.id });
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
  const [version] = await db
    .select({ id: agentVersions.id })
    .from(agentVersions)
    .innerJoin(agents, eq(agents.id, agentVersions.agentId))
    .where(and(
      eq(agentVersions.agentId, agentId),
      eq(agentVersions.workspaceId, DEMO_WORKSPACE_ID),
      inArray(agentVersions.status, ["candidate", "production"]),
      isNull(agents.archivedAt),
    ))
    .orderBy(desc(agentVersions.version))
    .limit(1);
  if (!version) return { ok: false, error: "请先发布一个待验收版本" };
  const cases = await db
    .select({ id: evaluationCases.id, input: evaluationCases.input })
    .from(evaluationCases)
    .where(and(
      eq(evaluationCases.agentId, agentId),
      eq(evaluationCases.workspaceId, DEMO_WORKSPACE_ID),
      isNull(evaluationCases.archivedAt),
    ));
  if (cases.length === 0) return { ok: false, error: "请先添加至少一条验收样例" };
  const [evaluation] = await db.insert(evaluationRuns).values({
    workspaceId: DEMO_WORKSPACE_ID,
    createdBy: DEMO_USER_ID,
    agentId,
    versionId: version.id,
    status: "running",
    totalCount: cases.length,
  }).returning({ id: evaluationRuns.id });
  await db.insert(evaluationCaseResults).values(cases.map((testCase) => ({
    workspaceId: DEMO_WORKSPACE_ID,
    createdBy: DEMO_USER_ID,
    evaluationRunId: evaluation.id,
    evaluationCaseId: testCase.id,
    status: "running",
  })));
  for (const testCase of cases) {
    const started = await startRunCore({
      agentId,
      versionId: version.id,
      input: testCase.input,
      sourceType: "evaluation",
      sourceKey: `evaluation:${evaluation.id}:${testCase.id}`,
    });
    if (started.ok) {
      await db
        .update(evaluationCaseResults)
        .set({ runId: started.runId, updatedAt: new Date() })
        .where(and(
          eq(evaluationCaseResults.evaluationRunId, evaluation.id),
          eq(evaluationCaseResults.evaluationCaseId, testCase.id),
        ));
    } else {
      await markEvaluationStartFailure(evaluation.id, testCase.id, started.error);
    }
  }
  revalidatePath(`/agents/${agentId}`);
  revalidatePath("/runs");
  return { ok: true };
}
