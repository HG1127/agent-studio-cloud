"use server";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { KnowledgeArchiveInput, type KnowledgeArchiveResult } from "@/contracts/knowledge";
import { agentVersions, agents, auditEvents, knowledgeSources, runs } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { auditEventValues } from "@/server/audit/event-values";
import { restoredKnowledgeStatus } from "@/server/domain/knowledge/source-state";
import { activeVersionDependingOnKnowledgeSource, liveRunDependingOnKnowledgeSource } from "@/server/domain/runtime/collaboration-dependencies";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";

export async function setKnowledgeSourceArchivedAction(input: unknown): Promise<KnowledgeArchiveResult> {
  const parsed = KnowledgeArchiveInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "知识来源标识不正确，请刷新页面后重试" };
  }
  try {
    const updated = await db.transaction(async (tx) => {
      // 与解析入库步骤锁同一来源行，恢复状态必须使用锁内最新的分片数和错误。
      const [source] = await tx
        .select({
          id: knowledgeSources.id,
          name: knowledgeSources.name,
          status: knowledgeSources.status,
          chunkCount: knowledgeSources.chunkCount,
          error: knowledgeSources.error,
          archivedAt: knowledgeSources.archivedAt,
        })
        .from(knowledgeSources)
        .where(and(
          eq(knowledgeSources.id, parsed.data.sourceId),
          eq(knowledgeSources.workspaceId, DEMO_WORKSPACE_ID),
        ))
        .for("update")
        .limit(1);
      if (!source) return false;
      if (parsed.data.archived === (source.archivedAt !== null)) return true;
      if (parsed.data.archived) {
        const dependencyVersions = await tx
          .select({
            versionId: agentVersions.id,
            agentId: agentVersions.agentId,
            agentName: agents.name,
            status: agentVersions.status,
            agentArchivedAt: agents.archivedAt,
            manifest: agentVersions.manifest,
          })
          .from(agentVersions)
          .innerJoin(agents, eq(agents.id, agentVersions.agentId))
          .where(and(
            eq(agentVersions.workspaceId, DEMO_WORKSPACE_ID),
            eq(agents.workspaceId, DEMO_WORKSPACE_ID),
          ));
        const dependent = activeVersionDependingOnKnowledgeSource(dependencyVersions, source.id);
        if (dependent) return { inUseBy: dependent.agentName };
        const liveRuns = await tx
          .select({ versionId: runs.versionId })
          .from(runs)
          .where(and(
            eq(runs.workspaceId, DEMO_WORKSPACE_ID),
            inArray(runs.status, ["queued", "running", "waiting_approval", "waiting_event"]),
          ));
        const liveDependent = liveRunDependingOnKnowledgeSource(
          dependencyVersions,
          new Set(liveRuns.map((run) => run.versionId)),
          source.id,
        );
        if (liveDependent) return { inUseBy: liveDependent.agentName, running: true };
      }
      const now = new Date();
      const rows = await tx
        .update(knowledgeSources)
        .set({
          archivedAt: parsed.data.archived ? now : null,
          status: parsed.data.archived ? "archived" : restoredKnowledgeStatus(source),
          updatedAt: now,
        })
        .where(and(
          eq(knowledgeSources.id, parsed.data.sourceId),
          eq(knowledgeSources.workspaceId, DEMO_WORKSPACE_ID),
          parsed.data.archived ? isNull(knowledgeSources.archivedAt) : isNotNull(knowledgeSources.archivedAt),
        ))
        .returning({ id: knowledgeSources.id });
      if (rows.length > 0) {
        await tx.insert(auditEvents).values(auditEventValues({
          workspaceId: DEMO_WORKSPACE_ID,
          createdBy: DEMO_USER_ID,
          action: parsed.data.archived ? "knowledge.archived" : "knowledge.restored",
          targetType: "knowledge",
          targetId: source.id,
          summary: `${parsed.data.archived ? "归档" : "恢复"}知识资料「${source.name}」`,
          data: {},
        }));
      }
      return rows.length > 0;
    });
    if (typeof updated === "object") {
      return updated.running
        ? { ok: false, error: `助手「${updated.inUseBy}」仍有运行中的任务需要这份资料，请等待运行结束后再归档` }
        : { ok: false, error: `助手「${updated.inUseBy}」的当前版本或待验收版本仍在使用这份资料，请先发布不再使用它的新版本` };
    }
    if (!updated) return { ok: false, error: "知识资料状态已经变化，请刷新页面后重试" };
    revalidatePath("/knowledge");
    return { ok: true };
  } catch (error) {
    console.error("更新知识资料状态失败", safeErrorForLog(error));
    return { ok: false, error: "更新知识资料状态失败，请稍后重试" };
  }
}

export async function archiveKnowledgeSourceAction(id: string): Promise<KnowledgeArchiveResult> {
  return setKnowledgeSourceArchivedAction({ sourceId: id, archived: true });
}
