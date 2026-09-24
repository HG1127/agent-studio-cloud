"use server";

import { and, desc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { AgentUpdateInput, type AgentUpdateResult } from "@/contracts/agent";
import { WorkflowDraft } from "@/contracts/workflow";
import { agents, workflowDefinitions } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";

export async function updateAgentAction(input: unknown): Promise<AgentUpdateResult> {
  const parsed = AgentUpdateInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "名称或说明填写不正确" };
  try {
    const [agent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, parsed.data.agentId), eq(agents.workspaceId, DEMO_WORKSPACE_ID), isNull(agents.archivedAt)))
      .limit(1);
    if (!agent) return { ok: false, error: "找不到这个助手，请刷新页面后重试" };
    const [definition] = await db
      .select({ id: workflowDefinitions.id, draft: workflowDefinitions.draft })
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.agentId, agent.id), eq(workflowDefinitions.workspaceId, DEMO_WORKSPACE_ID)))
      .orderBy(desc(workflowDefinitions.createdAt))
      .limit(1);
    if (!definition) return { ok: false, error: "找不到这个助手的流程草稿" };
    const draft = WorkflowDraft.safeParse(definition.draft);
    if (!draft.success) return { ok: false, error: "流程草稿格式不完整，暂时无法修改名称" };
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(agents)
        .set({ name: parsed.data.name, description: parsed.data.description || null, updatedAt: now })
        .where(eq(agents.id, agent.id));
      await tx
        .update(workflowDefinitions)
        .set({ draft: { ...draft.data, rootAgent: { ...draft.data.rootAgent, name: parsed.data.name } }, updatedAt: now })
        .where(eq(workflowDefinitions.id, definition.id));
    });
    revalidatePath("/agents");
    revalidatePath(`/agents/${agent.id}`);
    revalidatePath("/runs");
    revalidatePath("/schedules");
    return { ok: true };
  } catch (error) {
    console.error("更新助手信息失败", error);
    return { ok: false, error: "更新助手信息失败，请稍后重试" };
  }
}
