"use server";

import { and, desc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AuditFixActionResult } from "@/contracts/audit";
import { WorkflowDraft } from "@/contracts/workflow";
import { agents, auditEvents, workflowDefinitions } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { applySafeAuditFixes } from "@/server/domain/audit/safe-audit-fixes";
import { auditEventValues } from "@/server/audit/event-values";
import { bindWorkflowRootAgent } from "@/server/domain/workflow-root-agent";
import { validateInlineWorkflows } from "@/server/domain/runtime/inline-workflow";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";

export async function applyAuditFixesAction(agentId: string): Promise<AuditFixActionResult> {
  if (!z.string().uuid().safeParse(agentId).success) return { ok: false, error: "助手信息不正确，请刷新页面后重试" };
  try {
    const outcome = await db.transaction(async (tx) => {
      // 自动修复也必须与手工保存共用助手行锁，避免跨标签页覆盖刚保存的草稿。
      const [agent] = await tx.select({ id: agents.id, name: agents.name }).from(agents).where(and(
        eq(agents.id, agentId), eq(agents.workspaceId, DEMO_WORKSPACE_ID), isNull(agents.archivedAt),
      )).for("update").limit(1);
      if (!agent) return { kind: "agent-missing" as const };
      const [definition] = await tx
        .select({ id: workflowDefinitions.id, draft: workflowDefinitions.draft })
        .from(workflowDefinitions)
        .where(and(eq(workflowDefinitions.agentId, agent.id), eq(workflowDefinitions.workspaceId, DEMO_WORKSPACE_ID)))
        .orderBy(desc(workflowDefinitions.createdAt))
        .limit(1);
      if (!definition) return { kind: "definition-missing" as const };
      const draft = WorkflowDraft.safeParse(definition.draft);
      if (!draft.success) return { kind: "definition-invalid" as const };
      const inlineError = validateInlineWorkflows(draft.data);
      if (inlineError) return { kind: "inline-invalid" as const, error: inlineError };
      const result = applySafeAuditFixes(draft.data);
      if (result.applied.length === 0) return { kind: "unchanged" as const, agentId: agent.id, result };
      await tx
        .update(workflowDefinitions)
        .set({ draft: bindWorkflowRootAgent(result.draft, agent), updatedAt: new Date() })
        .where(and(eq(workflowDefinitions.id, definition.id), eq(workflowDefinitions.workspaceId, DEMO_WORKSPACE_ID)));
      await tx.insert(auditEvents).values(auditEventValues({
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        action: "workflow.auto_fixed",
        targetType: "workflow",
        targetId: definition.id,
        summary: `自动修复助手「${agent.name}」的流程`,
        data: {
          appliedCount: result.applied.length,
          remainingCritical: result.remainingCritical,
          remainingWarnings: result.remainingWarnings,
        },
      }));
      return { kind: "fixed" as const, agentId: agent.id, result };
    });
    if (outcome.kind === "agent-missing") return { ok: false, error: "找不到这个助手，请刷新页面后重试" };
    if (outcome.kind === "definition-missing") return { ok: false, error: "找不到这个助手的流程草稿" };
    if (outcome.kind === "definition-invalid") return { ok: false, error: "流程草稿格式不完整，无法自动修复" };
    if (outcome.kind === "inline-invalid") return { ok: false, error: `流程草稿无法执行：${outcome.error}` };
    revalidatePath(`/agents/${outcome.agentId}`);
    return {
      ok: true,
      applied: outcome.result.applied,
      skipped: outcome.result.skipped,
      remainingCritical: outcome.result.remainingCritical,
      remainingWarnings: outcome.result.remainingWarnings,
      ...(outcome.kind === "unchanged" ? { unchanged: true } : {}),
    };
  } catch (error) {
    console.error("自动修复流程失败", safeErrorForLog(error));
    return { ok: false, error: "自动修复失败，请稍后重试" };
  }
}
