"use server";

import { and, desc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SaveWorkflowResult } from "@/contracts/run";
import { WorkflowDraft } from "@/contracts/workflow";
import { agents, auditEvents, workflowDefinitions } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { auditEventValues } from "@/server/audit/event-values";
import { validateOutputContract } from "@/server/domain/runtime/output-contract";
import { validateWaitContracts } from "@/server/domain/runtime/wait-contract";
import { validateWorkflowRoutes } from "@/server/domain/runtime/workflow-routes";
import { validateInlineWorkflows } from "@/server/domain/runtime/inline-workflow";
import { bindWorkflowRootAgent } from "@/server/domain/workflow-root-agent";
import { validationMessage } from "@/server/domain/validation-message";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";

export async function saveWorkflowAction(
  agentId: string,
  draft: WorkflowDraft,
  expectedUpdatedAt?: string | null,
): Promise<SaveWorkflowResult> {
  if (!z.string().uuid().safeParse(agentId).success) {
    return { ok: false, error: "助手标识不正确，请刷新页面后重试" };
  }
  const parsed = WorkflowDraft.safeParse(draft);
  if (!parsed.success) {
    return {
      ok: false,
      error: validationMessage(parsed.error, "流程草稿没有通过保存校验，请检查各步骤内容后重试"),
    };
  }
  const outputError = validateOutputContract(parsed.data.outputContract?.fields ?? [], parsed.data.nodes);
  if (outputError) return { ok: false, error: outputError };
  const waitError = validateWaitContracts(parsed.data.nodes);
  if (waitError) return { ok: false, error: waitError };
  const routeError = validateWorkflowRoutes(parsed.data);
  if (routeError) return { ok: false, error: routeError };
  const inlineError = validateInlineWorkflows(parsed.data);
  if (inlineError) return { ok: false, error: inlineError };
  const expectedRevision = expectedUpdatedAt === undefined || expectedUpdatedAt === null
    ? null
    : new Date(expectedUpdatedAt);
  if (expectedRevision && Number.isNaN(expectedRevision.getTime())) {
    return { ok: false, error: "流程版本信息不正确，请刷新页面后重试" };
  }
  try {
    const result = await db.transaction(async (tx) => {
      // 与基本信息更新按同一助手行串行化，并拒绝旧页面给已归档助手写回草稿。
      const [agent] = await tx
        .select({ name: agents.name })
        .from(agents)
        .where(and(eq(agents.id, agentId), eq(agents.workspaceId, DEMO_WORKSPACE_ID), isNull(agents.archivedAt)))
        .for("update")
        .limit(1);
      if (!agent) return "agent-missing" as const;
      // 只更新最新一份流程定义，与详情页读取同一行，避免历史版本被误改。
      const [definition] = await tx
        .select({ id: workflowDefinitions.id, updatedAt: workflowDefinitions.updatedAt })
        .from(workflowDefinitions)
        .where(and(eq(workflowDefinitions.agentId, agentId), eq(workflowDefinitions.workspaceId, DEMO_WORKSPACE_ID)))
        .orderBy(desc(workflowDefinitions.createdAt))
        .limit(1);
      if (!definition) return "definition-missing" as const;
      if (expectedRevision && definition.updatedAt.getTime() !== expectedRevision.getTime()) {
        return "stale" as const;
      }
      const now = new Date();
      await tx
        .update(workflowDefinitions)
        .set({
          draft: bindWorkflowRootAgent(parsed.data, { id: agentId, name: agent.name }),
          updatedAt: now,
        })
        .where(and(eq(workflowDefinitions.id, definition.id), eq(workflowDefinitions.workspaceId, DEMO_WORKSPACE_ID)));
      await tx.insert(auditEvents).values(auditEventValues({
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        action: "workflow.saved",
        targetType: "workflow",
        targetId: definition.id,
        summary: `保存助手「${agent.name}」的流程`,
        data: { nodeCount: Object.keys(parsed.data.nodes).length },
      }));
      return { kind: "saved" as const, updatedAt: now.toISOString() };
    });
    if (result === "agent-missing") {
      return { ok: false, error: "找不到这个助手，或助手已归档，请刷新页面后重试" };
    }
    if (result === "definition-missing") {
      return { ok: false, error: "找不到这个助手的流程草稿，请刷新页面后重试" };
    }
    if (result === "stale") {
      return { ok: false, error: "流程已在其他页面发生变化；你的修改仍保留在本页，请刷新核对后再保存" };
    }
    revalidatePath(`/agents/${agentId}`);
    return { ok: true, updatedAt: result.updatedAt };
  } catch (error) {
    console.error("保存流程失败", safeErrorForLog(error));
    return { ok: false, error: "保存失败，请稍后重试" };
  }
}
