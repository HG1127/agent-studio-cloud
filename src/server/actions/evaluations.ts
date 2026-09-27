"use server";

import { and, count, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
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
import { agentVersions, agents, auditEvents, evaluationCaseResults, evaluationCases, evaluationRuns, runs } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { markEvaluationStartFailure, reconcileEvaluationSummary, reconcileTerminalEvaluationRun } from "@/server/services/evaluation-state";
import { prepareEvaluationRun } from "@/server/services/evaluation-start";
import { startRunCore } from "@/server/services/start-run-core";
import { runBounded } from "@/server/domain/run-bounded";
import { validationMessage } from "@/server/domain/validation-message";
import { auditEventValues } from "@/server/audit/event-values";
import { evaluationCaseSetsEqual, generateEvaluationCases } from "@/server/domain/evaluation-cases";
import { redactCredentialData } from "@/server/domain/security/redact-sensitive";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { jsonValuesEqual } from "@/server/domain/json-value";
import { revalidatePathsAfterCommit } from "@/server/actions/revalidate-paths";

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
      const active = await tx.select({
        name: evaluationCases.name,
        input: evaluationCases.input,
        expectations: evaluationCases.expectations,
      }).from(evaluationCases).where(and(
        eq(evaluationCases.agentId, agentId),
        eq(evaluationCases.workspaceId, DEMO_WORKSPACE_ID),
        isNull(evaluationCases.archivedAt),
      ));
      const [version] = await tx.select({ manifest: agentVersions.manifest }).from(agentVersions).where(and(
        eq(agentVersions.agentId, agentId),
        eq(agentVersions.workspaceId, DEMO_WORKSPACE_ID),
        inArray(agentVersions.status, ["candidate", "production"]),
      )).orderBy(desc(agentVersions.version)).limit(1);
      const manifest = version ? AgentManifest.safeParse(version.manifest) : null;
      if (!manifest?.success) return { ok: false as const, error: "请先发布一个可验收版本" };
      const generated = generateEvaluationCases(manifest.data).slice(0, MAX_EVALUATION_CASES);
      if (active.length > 0) {
        if (evaluationCaseSetsEqual(active, generated)) {
          return { ok: true as const, createdCount: generated.length, reused: true as const };
        }
        return { ok: false as const, error: "已有启用中的验收样例；如需重新生成，请先归档现有样例" };
      }
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
    if (result.ok) revalidatePathsAfterCommit([`/agents/${agentId}`], "evaluation-generate");
    return result;
  } catch (error) {
    console.error("生成验收样例失败", safeErrorForLog(error));
    return { ok: false, error: "生成验收样例失败，请稍后重试" };
  }
}

export async function createEvaluationCaseAction(input: unknown): Promise<EvaluationActionResult> {
  const parsed = EvaluationCaseCreateInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: validationMessage(parsed.error, "验收样例填写不完整，请检查后重试") };
  }
  const storedInput = redactCredentialData(parsed.data.input) as Record<string, unknown>;
  const storedExpectations = redactCredentialData(parsed.data.expectations) as typeof parsed.data.expectations;
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
      const duplicates = await tx
        .select({ input: evaluationCases.input, expectations: evaluationCases.expectations })
        .from(evaluationCases)
        .where(and(
          eq(evaluationCases.agentId, parsed.data.agentId),
          eq(evaluationCases.workspaceId, DEMO_WORKSPACE_ID),
          eq(evaluationCases.name, parsed.data.name),
          isNull(evaluationCases.archivedAt),
        ));
      if (duplicates.some((testCase) =>
        jsonValuesEqual(testCase.input, storedInput)
        && jsonValuesEqual(testCase.expectations, storedExpectations))) {
        return { ok: true as const };
      }
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
        input: storedInput,
        expectations: storedExpectations,
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
    revalidatePathsAfterCommit([`/agents/${parsed.data.agentId}`], "evaluation-case-create");
    return result;
  } catch (error) {
    console.error("创建验收样例失败", safeErrorForLog(error));
    return { ok: false, error: "创建验收样例失败，请稍后重试" };
  }
}

export async function updateEvaluationCaseAction(input: unknown): Promise<EvaluationActionResult> {
  const parsed = EvaluationCaseUpdateInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: validationMessage(parsed.error, "验收样例填写不完整，请检查后重试") };
  }
  const storedInput = redactCredentialData(parsed.data.input) as Record<string, unknown>;
  const storedExpectations = redactCredentialData(parsed.data.expectations) as typeof parsed.data.expectations;
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
      const [current] = await tx.select({
        id: evaluationCases.id,
        name: evaluationCases.name,
        input: evaluationCases.input,
        expectations: evaluationCases.expectations,
        updatedAt: evaluationCases.updatedAt,
      }).from(evaluationCases).where(and(
        eq(evaluationCases.id, parsed.data.caseId), eq(evaluationCases.agentId, parsed.data.agentId),
        eq(evaluationCases.workspaceId, DEMO_WORKSPACE_ID), isNull(evaluationCases.archivedAt),
      )).limit(1);
      if (!current) return [];
      if (current.name === parsed.data.name
        && jsonValuesEqual(current.input, storedInput)
        && jsonValuesEqual(current.expectations, storedExpectations)) {
        return "unchanged" as const;
      }
      if (current.updatedAt.getTime() !== new Date(parsed.data.expectedUpdatedAt).getTime()) return [];
      const rows = await tx.update(evaluationCases).set({
        name: parsed.data.name,
        input: storedInput,
        expectations: storedExpectations,
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
    if (rows === "unchanged") {
      revalidatePathsAfterCommit([`/agents/${parsed.data.agentId}`], "evaluation-case-update");
      return { ok: true };
    }
    if (rows.length === 0) return { ok: false, error: "验收样例已在其他页面发生变化；你的修改仍保留在本页，请刷新核对后再保存" };
    revalidatePathsAfterCommit([`/agents/${parsed.data.agentId}`], "evaluation-case-update");
    return { ok: true };
  } catch (error) {
    console.error("更新验收样例失败", safeErrorForLog(error));
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
      const [current] = await tx.select({
        id: evaluationCases.id,
        archivedAt: evaluationCases.archivedAt,
      }).from(evaluationCases).where(and(
        eq(evaluationCases.id, parsed.data.caseId), eq(evaluationCases.agentId, parsed.data.agentId),
        eq(evaluationCases.workspaceId, DEMO_WORKSPACE_ID),
      )).limit(1);
      if (!current) return [];
      if ((current.archivedAt !== null) === parsed.data.archived) return "unchanged" as const;
      if (!parsed.data.archived) {
        const [active] = await tx.select({ count: count() }).from(evaluationCases).where(and(
          eq(evaluationCases.agentId, parsed.data.agentId),
          eq(evaluationCases.workspaceId, DEMO_WORKSPACE_ID),
          isNull(evaluationCases.archivedAt),
        ));
        if ((active?.count ?? 0) >= MAX_EVALUATION_CASES) return "limit" as const;
      }
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
    if (updated === "limit") return { ok: false, error: `每个助手最多保留 ${MAX_EVALUATION_CASES} 条启用中的验收样例` };
    if (updated === "unchanged") {
      revalidatePathsAfterCommit([`/agents/${parsed.data.agentId}`], "evaluation-case-archive");
      return { ok: true };
    }
    if (updated.length === 0) return { ok: false, error: "验收样例状态已经变化，请刷新页面后重试" };
    revalidatePathsAfterCommit([`/agents/${parsed.data.agentId}`], "evaluation-case-archive");
    return { ok: true };
  } catch (error) {
    console.error("更新验收样例状态失败", safeErrorForLog(error));
    return { ok: false, error: "更新验收样例状态失败，请稍后重试" };
  }
}

export async function startEvaluationAction(agentId: string, requestId?: string): Promise<EvaluationActionResult> {
  if (!z.string().uuid().safeParse(agentId).success || (requestId && !z.string().uuid().safeParse(requestId).success)) {
    return { ok: false, error: "助手或验收请求信息不正确" };
  }
  try {
    const prepared = await prepareEvaluationRun(agentId, requestId);
    if (!prepared.ok) return prepared;
    let needsRetry = false;
    await runBounded(prepared.cases, EVALUATION_START_CONCURRENCY, async (testCase) => {
      const sourceKey = `evaluation:${prepared.evaluationId}:${testCase.id}`;
      let started: Awaited<ReturnType<typeof startRunCore>> | null = null;
      try {
        started = await startRunCore({
          agentId,
          versionId: prepared.versionId,
          input: testCase.input,
          sourceType: "evaluation",
          sourceKey,
        });
      } catch (error) {
        console.error("启动单条验收运行失败", safeErrorForLog(error));
      }
      let runId = started?.ok ? started.runId : null;
      if (!runId) {
        try {
          const [existing] = await db
            .select({ id: runs.id, status: runs.status })
            .from(runs)
            .where(and(eq(runs.workspaceId, DEMO_WORKSPACE_ID), eq(runs.sourceKey, sourceKey)))
            .limit(1);
          if (existing) {
            runId = existing.id;
            if (existing.status === "queued") needsRetry = true;
          } else if (started && !started.ok) {
            await markEvaluationStartFailure(prepared.evaluationId, testCase.id, started.error, DEMO_WORKSPACE_ID);
            return;
          } else {
            // 启动异常可能发生在提交运行之后；保留待处理状态供同一 sourceKey 补启。
            needsRetry = true;
            return;
          }
        } catch (error) {
          console.error("核对验收启动状态时出错", safeErrorForLog(error));
          needsRetry = true;
          return;
        }
      }
      try {
        await db
          .update(evaluationCaseResults)
          .set({ runId, updatedAt: new Date() })
          .where(and(
            eq(evaluationCaseResults.evaluationRunId, prepared.evaluationId),
            eq(evaluationCaseResults.evaluationCaseId, testCase.id),
            eq(evaluationCaseResults.workspaceId, DEMO_WORKSPACE_ID),
          ));
        await reconcileTerminalEvaluationRun(runId);
      } catch (error) {
        console.error("验收运行已启动但结果尚未对账", safeErrorForLog(error));
        needsRetry = true;
      }
    });
    // 进程可能在“最后一条结果已落库、整轮汇总未完成”之间中断；即使没有待补启样例也要重新对账。
    await reconcileEvaluationSummary(prepared.evaluationId);
    revalidatePathsAfterCommit([`/agents/${agentId}`, "/runs"], "evaluation-start");
    return needsRetry
      ? { ok: false, error: "部分验收结果尚未对账，请点击“检查并继续”重试" }
      : { ok: true };
  } catch (error) {
    console.error("启动自动验收失败", safeErrorForLog(error));
    return { ok: false, error: "启动自动验收失败，请稍后重试" };
  }
}
