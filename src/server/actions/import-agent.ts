"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ImportAgentResult } from "@/contracts/agent";
import { agents, agentVersions, auditEvents, workflowDefinitions } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { agentImportSizeIssue, importedCollaborationKeys, normalizeAgentImport, rebindImportedWorkflow } from "@/server/domain/import-agent";
import { auditEventValues } from "@/server/audit/event-values";

export async function importAgentAction(input: unknown): Promise<ImportAgentResult> {
  const sizeIssue = agentImportSizeIssue(input);
  if (sizeIssue) return { ok: false, error: sizeIssue };
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
      const collaborationKeys = importedCollaborationKeys(imported.workflow);
      const uuid = z.string().uuid();
      const versionIds = [...new Set(collaborationKeys
        .map((key) => key.slice(key.lastIndexOf(":") + 1))
        .filter((id) => uuid.safeParse(id).success))];
      const validRows = versionIds.length > 0
        ? await tx
            .select({ agentId: agentVersions.agentId, versionId: agentVersions.id })
            .from(agentVersions)
            .innerJoin(agents, eq(agents.id, agentVersions.agentId))
            .where(and(
              inArray(agentVersions.id, versionIds),
              eq(agentVersions.workspaceId, DEMO_WORKSPACE_ID),
              eq(agents.workspaceId, DEMO_WORKSPACE_ID),
              isNull(agents.archivedAt),
            ))
        : [];
      const workflow = rebindImportedWorkflow({
        workflow: imported.workflow,
        agentId: created.id,
        agentName: imported.name,
        validCollaborationKeys: new Set(validRows.map((row) => `${row.agentId}:${row.versionId}`)),
      });
      await tx.insert(workflowDefinitions).values({
        agentId: created.id,
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        draft: workflow,
      });
      await tx.insert(auditEvents).values(auditEventValues({
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        action: "agent.imported",
        targetType: "agent",
        targetId: created.id,
        summary: `导入助手「${imported.name}」`,
        data: { nodeCount: Object.keys(workflow.nodes).length },
      }));
      return created.id;
    });
    revalidatePath("/agents");
    return { ok: true, agentId };
  } catch {
    return { ok: false, error: "导入失败，请稍后重试" };
  }
}
