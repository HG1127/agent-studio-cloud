"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { SaveWorkflowResult } from "@/contracts/run";
import { WorkflowDraft } from "@/contracts/workflow";
import { workflowDefinitions } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";

export async function saveWorkflowAction(agentId: string, draft: WorkflowDraft): Promise<SaveWorkflowResult> {
  if (!z.string().uuid().safeParse(agentId).success) {
    return { ok: false, error: "助手标识不正确，请刷新页面后重试" };
  }
  const parsed = WorkflowDraft.safeParse(draft);
  if (!parsed.success) {
    return { ok: false, error: "流程草稿没有通过保存校验，请检查各步骤内容后重试" };
  }
  try {
    // 只更新最新一份流程定义，与详情页读取同一行，避免历史版本被误改
    const [definition] = await db
      .select({ id: workflowDefinitions.id })
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.agentId, agentId), eq(workflowDefinitions.workspaceId, DEMO_WORKSPACE_ID)))
      .orderBy(desc(workflowDefinitions.createdAt))
      .limit(1);
    if (!definition) {
      return { ok: false, error: "找不到这个助手的流程草稿，请刷新页面后重试" };
    }
    await db
      .update(workflowDefinitions)
      .set({ draft: parsed.data, updatedAt: new Date() })
      .where(eq(workflowDefinitions.id, definition.id));
    revalidatePath(`/agents/${agentId}`);
    return { ok: true };
  } catch {
    return { ok: false, error: "保存失败，请稍后重试" };
  }
}
