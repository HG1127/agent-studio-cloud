"use server";

import { revalidatePath } from "next/cache";
import type { ImportAgentResult } from "@/contracts/agent";
import { agents, workflowDefinitions } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { normalizeAgentImport } from "@/server/domain/import-agent";

export async function importAgentAction(input: unknown): Promise<ImportAgentResult> {
  const imported = normalizeAgentImport(input);
  if (!imported) return { ok: false, error: "文件不是有效的助手定义或冻结版本，或文件版本暂不兼容" };
  try {
    const agentId = await db.transaction(async (tx) => {
      const [created] = await tx.insert(agents).values({
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        name: imported.name,
        description: imported.description,
        intentText: imported.intentText,
        status: "draft",
      }).returning({ id: agents.id });
      await tx.insert(workflowDefinitions).values({
        agentId: created.id,
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        draft: imported.workflow,
      });
      return created.id;
    });
    revalidatePath("/agents");
    return { ok: true, agentId };
  } catch {
    return { ok: false, error: "导入失败，请稍后重试" };
  }
}
