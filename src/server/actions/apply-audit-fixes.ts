"use server";

import { and, desc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AuditFixActionResult } from "@/contracts/audit";
import { WorkflowDraft } from "@/contracts/workflow";
import { agents, workflowDefinitions } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { applySafeAuditFixes } from "@/server/domain/audit/safe-audit-fixes";

export async function applyAuditFixesAction(agentId: string): Promise<AuditFixActionResult> {
  if (!z.string().uuid().safeParse(agentId).success) return { ok: false, error: "助手信息不正确，请刷新页面后重试" };
  try {
    const [agent] = await db.select({ id: agents.id }).from(agents).where(and(
      eq(agents.id, agentId), eq(agents.workspaceId, DEMO_WORKSPACE_ID), isNull(agents.archivedAt),
    )).limit(1);
    if (!agent) return { ok: false, error: "找不到这个助手，请刷新页面后重试" };
    const [definition] = await db
      .select({ id: workflowDefinitions.id, draft: workflowDefinitions.draft })
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.agentId, agent.id), eq(workflowDefinitions.workspaceId, DEMO_WORKSPACE_ID)))
      .orderBy(desc(workflowDefinitions.createdAt))
      .limit(1);
    if (!definition) return { ok: false, error: "找不到这个助手的流程草稿" };
    const draft = WorkflowDraft.safeParse(definition.draft);
    if (!draft.success) return { ok: false, error: "流程草稿格式不完整，无法自动修复" };
    const result = applySafeAuditFixes(draft.data);
    if (result.applied.length === 0) return { ok: false, error: "没有可安全自动修复的问题，其余问题需要人工判断" };
    await db
      .update(workflowDefinitions)
      .set({ draft: result.draft, updatedAt: new Date() })
      .where(eq(workflowDefinitions.id, definition.id));
    revalidatePath(`/agents/${agent.id}`);
    return {
      ok: true,
      applied: result.applied,
      skipped: result.skipped,
      remainingCritical: result.remainingCritical,
      remainingWarnings: result.remainingWarnings,
    };
  } catch (error) {
    console.error("自动修复流程失败", error);
    return { ok: false, error: "自动修复失败，请稍后重试" };
  }
}
