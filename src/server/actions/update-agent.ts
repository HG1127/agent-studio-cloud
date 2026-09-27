"use server";

import { and, desc, eq, isNull } from "drizzle-orm";
import { AgentUpdateInput, type AgentUpdateResult } from "@/contracts/agent";
import { WorkflowDraft } from "@/contracts/workflow";
import { agents, auditEvents, workflowDefinitions } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { auditEventValues } from "@/server/audit/event-values";
import { bindWorkflowRootAgent } from "@/server/domain/workflow-root-agent";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { revalidatePathsAfterCommit } from "@/server/actions/revalidate-paths";

export async function updateAgentAction(input: unknown): Promise<AgentUpdateResult> {
  const parsed = AgentUpdateInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "名称或说明填写不正确" };
  try {
    const result = await db.transaction(async (tx) => {
      // 与流程保存共用同一把助手行锁，避免名称与整份草稿并发写入时互相覆盖。
      const [agent] = await tx
        .select({ id: agents.id, name: agents.name, description: agents.description, updatedAt: agents.updatedAt })
        .from(agents)
        .where(and(eq(agents.id, parsed.data.agentId), eq(agents.workspaceId, DEMO_WORKSPACE_ID), isNull(agents.archivedAt)))
        .for("update")
        .limit(1);
      if (!agent) return { kind: "agent-missing" as const };
      if (agent.updatedAt.getTime() !== new Date(parsed.data.expectedUpdatedAt).getTime()) {
        if (agent.name === parsed.data.name && agent.description === (parsed.data.description || null)) {
          return { kind: "updated" as const, agentId: agent.id, updatedAt: agent.updatedAt.toISOString() };
        }
        return { kind: "stale" as const };
      }
      const [definition] = await tx
        .select({ id: workflowDefinitions.id, draft: workflowDefinitions.draft })
        .from(workflowDefinitions)
        .where(and(eq(workflowDefinitions.agentId, agent.id), eq(workflowDefinitions.workspaceId, DEMO_WORKSPACE_ID)))
        .orderBy(desc(workflowDefinitions.createdAt))
        .limit(1);
      if (!definition) return { kind: "definition-missing" as const };
      const draft = WorkflowDraft.safeParse(definition.draft);
      if (!draft.success) return { kind: "definition-invalid" as const };
      const now = new Date();
      await tx
        .update(agents)
        .set({ name: parsed.data.name, description: parsed.data.description || null, updatedAt: now })
        .where(and(eq(agents.id, agent.id), eq(agents.workspaceId, DEMO_WORKSPACE_ID)));
      await tx
        .update(workflowDefinitions)
        .set({ draft: bindWorkflowRootAgent(draft.data, { id: agent.id, name: parsed.data.name }), updatedAt: now })
        .where(and(eq(workflowDefinitions.id, definition.id), eq(workflowDefinitions.workspaceId, DEMO_WORKSPACE_ID)));
      await tx.insert(auditEvents).values(auditEventValues({
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        action: "agent.updated",
        targetType: "agent",
        targetId: agent.id,
        summary: `修改助手「${parsed.data.name}」的基本信息`,
        data: {},
      }));
      return { kind: "updated" as const, agentId: agent.id, updatedAt: now.toISOString() };
    });
    if (result.kind === "agent-missing") return { ok: false, error: "找不到这个助手，请刷新页面后重试" };
    if (result.kind === "stale") return { ok: false, error: "助手信息已在其他页面发生变化；你的修改仍保留在本页，请刷新核对后再保存" };
    if (result.kind === "definition-missing") return { ok: false, error: "找不到这个助手的流程草稿" };
    if (result.kind === "definition-invalid") return { ok: false, error: "流程草稿格式不完整，暂时无法修改名称" };
    revalidatePathsAfterCommit(["/agents", `/agents/${result.agentId}`, "/runs", "/schedules"], "agent-update");
    return { ok: true, updatedAt: result.updatedAt };
  } catch (error) {
    console.error("更新助手信息失败", safeErrorForLog(error));
    return { ok: false, error: "更新助手信息失败，请稍后重试" };
  }
}
