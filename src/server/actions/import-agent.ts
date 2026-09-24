"use server";

import { revalidatePath } from "next/cache";
import { AgentExportFile, type ImportAgentResult } from "@/contracts/agent";
import { agents, workflowDefinitions } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";

export async function importAgentAction(input: unknown): Promise<ImportAgentResult> {
  const parsed = AgentExportFile.safeParse(input);
  if (!parsed.success) return { ok: false, error: "文件不是有效的助手定义，或版本暂不兼容" };
  try {
    const agentId = await db.transaction(async (tx) => {
      const [created] = await tx.insert(agents).values({
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        name: parsed.data.agent.name,
        description: parsed.data.agent.description,
        intentText: parsed.data.agent.intentText,
        status: "draft",
      }).returning({ id: agents.id });
      await tx.insert(workflowDefinitions).values({
        agentId: created.id,
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        draft: parsed.data.workflow,
      });
      return created.id;
    });
    revalidatePath("/agents");
    return { ok: true, agentId };
  } catch {
    return { ok: false, error: "导入失败，请稍后重试" };
  }
}
