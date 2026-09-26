"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ImportAgentResult } from "@/contracts/agent";
import { agents, agentVersions, auditEvents, workflowDefinitions } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { agentImportSizeIssue, importedCollaborationKeys, importedWorkflowIssue, normalizeAgentImport, rebindImportedWorkflow } from "@/server/domain/import-agent";
import { auditEventValues } from "@/server/audit/event-values";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { agentIdentityMatches } from "@/server/domain/agent-identity";

export async function importAgentAction(input: unknown, requestId: string): Promise<ImportAgentResult> {
  if (!z.string().uuid().safeParse(requestId).success) return { ok: false, error: "导入请求信息不正确，请重新选择文件" };
  const sizeIssue = agentImportSizeIssue(input);
  if (sizeIssue) return { ok: false, error: sizeIssue };
  const imported = normalizeAgentImport(input);
  if (!imported) return { ok: false, error: "文件不是有效的助手定义或冻结版本，或文件版本暂不兼容" };
  const workflowIssue = importedWorkflowIssue(imported.workflow);
  if (workflowIssue) return { ok: false, error: `导入的流程无法使用：${workflowIssue}` };
  try {
    const [existing] = await db.select({
      id: agents.id,
      name: agents.name,
      description: agents.description,
      intentText: agents.intentText,
    }).from(agents).innerJoin(workflowDefinitions, and(
      eq(workflowDefinitions.agentId, agents.id),
      eq(workflowDefinitions.workspaceId, DEMO_WORKSPACE_ID),
    )).where(and(
      eq(agents.id, requestId),
      eq(agents.workspaceId, DEMO_WORKSPACE_ID),
    )).limit(1);
    if (existing) {
      return agentIdentityMatches(existing, imported)
        ? { ok: true, agentId: existing.id }
        : { ok: false, error: "导入请求信息已经失效，请重新选择文件" };
    }
    const agentId = await db.transaction(async (tx) => {
      const [created] = await tx.insert(agents).values({
        id: requestId,
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
  } catch (error) {
    try {
      const [existing] = await db.select({
        id: agents.id,
        name: agents.name,
        description: agents.description,
        intentText: agents.intentText,
      }).from(agents).innerJoin(workflowDefinitions, and(
        eq(workflowDefinitions.agentId, agents.id),
        eq(workflowDefinitions.workspaceId, DEMO_WORKSPACE_ID),
      )).where(and(
        eq(agents.id, requestId),
        eq(agents.workspaceId, DEMO_WORKSPACE_ID),
      )).limit(1);
      if (existing && agentIdentityMatches(existing, imported)) {
        revalidatePath("/agents");
        return { ok: true, agentId: existing.id };
      }
    } catch (recoveryError) {
      console.error("确认导入结果失败", safeErrorForLog(recoveryError));
    }
    console.error("导入助手失败", safeErrorForLog(error));
    return { ok: false, error: "导入失败，请稍后重试" };
  }
}
