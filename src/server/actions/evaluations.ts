"use server";

import { and, count, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  EvaluationCaseArchiveInput,
  EvaluationCaseCreateInput,
  EvaluationCaseUpdateInput,
  MAX_EVALUATION_CASES,
  type EvaluationActionResult,
  type EvaluationGenerateResult,
} from "@/contracts/evaluation";
import { AgentManifest } from "@/contracts/manifest";
import { agentVersions, agents, auditEvents, evaluationCaseResults, evaluationCases, evaluationRuns } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { markEvaluationStartFailure, reconcileEvaluationSummary, reconcileTerminalEvaluationRun } from "@/server/services/evaluation-state";
import { prepareEvaluationRun } from "@/server/services/evaluation-start";
import { startRunCore } from "@/server/services/start-run-core";
import { runBounded } from "@/server/domain/run-bounded";
import { validationMessage } from "@/server/domain/validation-message";
import { auditEventValues } from "@/server/audit/event-values";
import { generateEvaluationCases } from "@/server/domain/evaluation-cases";
import { redactCredentialData } from "@/server/domain/security/redact-sensitive";

const EVALUATION_START_CONCURRENCY = 5;

export async function generateEvaluationCasesAction(agentId: string): Promise<EvaluationGenerateResult> {
  if (!z.string().uuid().safeParse(agentId).success) return { ok: false, error: "助手信息不正确" };
  try {
    const result = await db.transaction(async (tx) => {
      const [agent] = await tx.select({ id: agents.id, name: agents.name }).from(agents).where(and(
        eq(agents.id, agentId), eq(agents.workspaceId, DEMO_WORKSPACE_ID), isNull(agents.archivedAt),
      )).for("update").limit(1);
      if (!agent) return { ok: false as const, error: "找不到这个助手，请刷新页面后重试" };
      const [running] = await tx.select({ id: evaluationRuns.id }).from(evaluationRuns).where(and(
        eq(evaluationRuns.agentId, agentId),
        eq(evaluationRuns.workspaceId, DEMO_WORKSPACE_ID),
        eq(evaluationRuns.status, "running"),
      )).limit(1);
      if (running) return { ok: false as const, error: "自动验收运行期间不能生成验收样例" };
      const [active] = await tx.select({ count: count() }).from(evaluationCases).where(and(
        eq(evaluationCases.agentId, agentId),
        eq(evaluationCases.workspaceId, DEMO_WORKSPACE_ID),
        isNull(evaluationCases.archivedAt),
      ));
      if ((active?.count ?? 0) > 0) {
        return { ok: false as const, error: "已有启用中的验收样例；如需重新生成，请先归档现有样例" };
      }
      const [version] = await tx.select({ manifest: agentVersions.manifest }).from(agentVersions).where(and(
        eq(agentVersions.agentId, agentId),
        eq(agentVersions.workspaceId, DEMO_WORKSPACE_ID),
        inArray(agentVersions.status, ["candidate", "production"]),
      )).orderBy(desc(agentVersions.version)).limit(1);
      const manifest = version ? AgentManifest.safeParse(version.manifest) : null;
      if (!manifest?.success) return { ok: false as const, error: "请先发布一个可验收版本" };
      const generated = generateEvaluationCases(manifest.data).slice(0, MAX_EVALUATION_CASES);
      await tx.insert(evaluationCases).values(generated.map((testCase) => ({
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        agentId,
        name: testCase.name,
        input: testCase.input,
        expectations: testCase.expectations,
      })));
      await tx.insert(auditEvents).values(auditEventValues({
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        action: "evaluation_case.created",
        targetType: "evaluation",
        targetId: agent.id,
        summary: `为助手「${agent.name}」从发布契约生成 ${generated.length} 条验收样例`,
        data: { generated: true, caseCount: generated.length },
      }));
      return { ok: true as const, createdCount: generated.length };
    });
    if (result.ok) revalidatePath(`/agents/${agentId}`);
    return result;
  } catch (error) {
    console.error("生成验收样例失败", error);
    return { ok: false, error: "生成验收样例失败，请稍后重试" };
  }
}

export async function createEvaluationCaseAction(input: unknown): Promise<EvaluationActionResult> {
  const parsed = EvaluationCaseCreateInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: validationMessage(parsed.error, "验收样例填写不完整，请检查后重试") };
  }
  try {
    const result = await db.transaction(async (tx) => {
      const [agent] = await tx.select({ id: agents.id, name: agents.name }).from(agents).where(and(
        eq(agents.id, parsed.data.agentId), eq(agents.workspaceId, DEMO_WORKSPACE_ID), isNull(agents.archivedAt),
      )).for("update").limit(1);
      if (!agent) return { ok: false as const, error: "找不到这个助手，请刷新页面后重试" };
      const [running] = await tx.select({ id: evaluationRuns.id }).from(evaluationRuns).where(and(
        eq(evaluationRuns.agentId, parsed.data.agentId),
        eq(evaluationRuns.workspaceId, DEMO_WORKSPACE_ID),
        eq(evaluationRuns.status, "running"),
      )).limit(1);
      if (running) return { ok: false as const, error: "自动验收运行期间不能修改验收样例" };
      const [active] = await tx.select({ count: count() }).from(evaluationCases).where(and(
        eq(evaluationCases.agentId, parsed.data.agentId),
        eq(evaluationCases.workspaceId, DEMO_WORKSPACE_ID),
        isNull(evaluationCases.archivedAt),
      ));
      if ((active?.count ?? 0) >= MAX_EVALUATION_CASES) {
        return { ok: false as const, error: `每个助手最多保留 ${MAX_EVALUATION_CASES} 条启用中的验收样例` };
      }
      const [created] = await tx.insert(evaluationCases).values({
        workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, agentId: parsed.data.agentId,
        name: parsed.data.name,
        input: redactCredentialData(parsed.data.input) as Record<string, unknown>,
        expectations: redactCredentialData(parsed.data.expectations) as typeof parsed.data.expectations,
      }).returning({ id: evaluationCases.id });
      await tx.insert(auditEvents).values(auditEventValues({
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        action: "evaluation_case.created",
        targetType: "evaluation",
        targetId: created.id,
        summary: `为助手「${agent.name}」创建验收样例「${parsed.data.name}」`,
        data: { expectationCount: parsed.data.expectations.length },
      }));
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
  if (!parsed.success) {
    return { ok: false, error: validationMessage(parsed.error, "验收样例填写不完整，请检查后重试") };
  }
  try {
    const rows = await db.transaction(async (tx) => {
      const [agent] = await tx.select({ id: agents.id, name: agents.name }).from(agents).where(and(
        eq(agents.id, parsed.data.agentId), eq(agents.workspaceId, DEMO_WORKSPACE_ID), isNull(agents.archivedAt),
      )).for("update").limit(1);
      if (!agent) return null;
      const [running] = await tx.select({ id: evaluationRuns.id }).from(evaluationRuns).where(and(
        eq(evaluationRuns.agentId, parsed.data.agentId),
        eq(evaluationRuns.workspaceId, DEMO_WORKSPACE_ID),
        eq(evaluationRuns.status, "running"),
      )).limit(1);
      if (running) return "running" as const;
      const rows = await tx.update(evaluationCases).set({
        name: parsed.data.name,
        input: redactCredentialData(parsed.data.input) as Record<string, unknown>,
        expectations: redactCredentialData(parsed.data.expectations) as typeof parsed.data.expectations,
        updatedAt: new Date(),
      }).where(and(
        eq(evaluationCases.id, parsed.data.caseId), eq(evaluationCases.agentId, parsed.data.agentId),
        eq(evaluationCases.workspaceId, DEMO_WORKSPACE_ID), isNull(evaluationCases.archivedAt),
        eq(evaluationCases.updatedAt, new Date(parsed.data.expectedUpdatedAt)),
      )).returning({ id: evaluationCases.id });
      if (rows.length > 0) {
        await tx.insert(auditEvents).values(auditEventValues({
          workspaceId: DEMO_WORKSPACE_ID,
          createdBy: DEMO_USER_ID,
          action: "evaluation_case.updated",
          targetType: "evaluation",
          targetId: rows[0].id,
          summary: `修改助手「${agent.name}」的验收样例「${parsed.data.name}」`,
          data: { expectationCount: parsed.data.expectations.length },
        }));
      }
      return rows;
    });
    if (rows === "running") return { ok: false, error: "自动验收运行期间不能修改验收样例" };
    if (!rows) return { ok: false, error: "找不到这个助手，请刷新页面后重试" };
    if (rows.length === 0) return { ok: false, error: "验收样例已在其他页面发生变化；你的修改仍保留在本页，请刷新核对后再保存" };
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
      const [agent] = await tx.select({ id: agents.id, name: agents.name }).from(agents).where(and(
        eq(agents.id, parsed.data.agentId), eq(agents.workspaceId, DEMO_WORKSPACE_ID), isNull(agents.archivedAt),
      )).for("update").limit(1);
      if (!agent) return null;
      const [running] = await tx.select({ id: evaluationRuns.id }).from(evaluationRuns).where(and(
        eq(evaluationRuns.agentId, parsed.data.agentId),
        eq(evaluationRuns.workspaceId, DEMO_WORKSPACE_ID),
        eq(evaluationRuns.status, "running"),
      )).limit(1);
      if (running) return "running" as const;
      const rows = await tx.update(evaluationCases)
        .set({ archivedAt: parsed.data.archived ? new Date() : null, updatedAt: new Date() })
        .where(and(
          eq(evaluationCases.id, parsed.data.caseId), eq(evaluationCases.agentId, parsed.data.agentId),
          eq(evaluationCases.workspaceId, DEMO_WORKSPACE_ID),
          parsed.data.archived ? isNull(evaluationCases.archivedAt) : isNotNull(evaluationCases.archivedAt),
        ))
        .returning({ id: evaluationCases.id, name: evaluationCases.name });
      if (rows.length > 0) {
        await tx.insert(auditEvents).values(auditEventValues({
          workspaceId: DEMO_WORKSPACE_ID,
          createdBy: DEMO_USER_ID,
          action: parsed.data.archived ? "evaluation_case.archived" : "evaluation_case.restored",
          targetType: "evaluation",
          targetId: rows[0].id,
          summary: `${parsed.data.archived ? "归档" : "恢复"}助手「${agent.name}」的验收样例「${rows[0].name}」`,
          data: {},
        }));
      }
      return rows;
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
    await runBounded(prepared.cases, EVALUATION_START_CONCURRENCY, async (testCase) => {
      try {
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
              eq(evaluationCaseResults.workspaceId, DEMO_WORKSPACE_ID),
            ));
          await reconcileTerminalEvaluationRun(started.runId);
          return;
        }
        await markEvaluationStartFailure(prepared.evaluationId, testCase.id, started.error, DEMO_WORKSPACE_ID);
      } catch (error) {
        console.error("启动单条验收运行失败", error);
        await markEvaluationStartFailure(
          prepared.evaluationId,
          testCase.id,
          "验收运行启动失败，请稍后重新运行全部样例",
          DEMO_WORKSPACE_ID,
        );
      }
    });
    // 进程可能在“最后一条结果已落库、整轮汇总未完成”之间中断；即使没有待补启样例也要重新对账。
    await reconcileEvaluationSummary(prepared.evaluationId);
    revalidatePath(`/agents/${agentId}`);
    revalidatePath("/runs");
    return { ok: true };
  } catch (error) {
    console.error("启动自动验收失败", error);
    return { ok: false, error: "启动自动验收失败，请稍后重试" };
  }
}
