"use server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { knowledgeSources } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";

export async function archiveKnowledgeSourceAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!z.string().uuid().safeParse(id).success) {
    return { ok: false, error: "知识来源标识不正确，请刷新页面后重试" };
  }
  const result = await db
    .update(knowledgeSources)
    .set({ status: "archived", archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(knowledgeSources.id, id), eq(knowledgeSources.workspaceId, DEMO_WORKSPACE_ID), isNull(knowledgeSources.archivedAt)))
    .returning({ id: knowledgeSources.id });
  if (result.length === 0) {
    return { ok: false, error: "找不到这条知识来源，请刷新页面后重试" };
  }
  return { ok: true };
}
