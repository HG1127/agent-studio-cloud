"use server";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { KnowledgeArchiveInput, type KnowledgeArchiveResult } from "@/contracts/knowledge";
import { knowledgeSources } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { restoredKnowledgeStatus } from "@/server/domain/knowledge/source-state";

export async function setKnowledgeSourceArchivedAction(input: unknown): Promise<KnowledgeArchiveResult> {
  const parsed = KnowledgeArchiveInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "知识来源标识不正确，请刷新页面后重试" };
  }
  try {
    const [source] = await db
      .select({ status: knowledgeSources.status, chunkCount: knowledgeSources.chunkCount, error: knowledgeSources.error })
      .from(knowledgeSources)
      .where(and(
        eq(knowledgeSources.id, parsed.data.sourceId),
        eq(knowledgeSources.workspaceId, DEMO_WORKSPACE_ID),
        parsed.data.archived ? isNull(knowledgeSources.archivedAt) : isNotNull(knowledgeSources.archivedAt),
      ))
      .limit(1);
    if (!source) return { ok: false, error: "知识资料状态已经变化，请刷新页面后重试" };

    const now = new Date();
    const rows = await db
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
    if (rows.length === 0) return { ok: false, error: "知识资料状态已经变化，请刷新页面后重试" };
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
