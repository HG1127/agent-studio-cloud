"use server";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { KnowledgeArchiveInput, type KnowledgeArchiveResult } from "@/contracts/knowledge";
import { auditEvents, knowledgeSources } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { auditEventValues } from "@/server/audit/event-values";
import { restoredKnowledgeStatus } from "@/server/domain/knowledge/source-state";

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
        })
        .from(knowledgeSources)
        .where(and(
          eq(knowledgeSources.id, parsed.data.sourceId),
          eq(knowledgeSources.workspaceId, DEMO_WORKSPACE_ID),
          parsed.data.archived ? isNull(knowledgeSources.archivedAt) : isNotNull(knowledgeSources.archivedAt),
        ))
        .for("update")
        .limit(1);
      if (!source) return false;
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
    if (!updated) return { ok: false, error: "知识资料状态已经变化，请刷新页面后重试" };
    revalidatePath("/knowledge");
    return { ok: true };
  } catch (error) {
    console.error("更新知识资料状态失败", error);
    return { ok: false, error: "更新知识资料状态失败，请稍后重试" };
  }
}

export async function archiveKnowledgeSourceAction(id: string): Promise<KnowledgeArchiveResult> {
  return setKnowledgeSourceArchivedAction({ sourceId: id, archived: true });
}
