"use server";

import { randomUUID } from "node:crypto";
import { get } from "@vercel/blob";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { start } from "workflow/api";
import { z } from "zod";
import type { KnowledgeRetryResult } from "@/contracts/knowledge";
import { auditEvents, knowledgeSources } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { auditEventValues } from "@/server/audit/event-values";
import { knowledgeIngestWorkflow } from "@/server/workflows/knowledge-ingest";
import { isKnowledgeParsingStalled } from "@/server/domain/knowledge/source-state";

async function cancelBlobStream(stream: ReadableStream<Uint8Array>): Promise<void> {
  try {
    await stream.cancel();
  } catch {
    // 流可能已经被远端关闭；清理失败不覆盖原业务结果。
  }
}

export async function retryKnowledgeSourceAction(sourceId: string): Promise<KnowledgeRetryResult> {
  if (!z.string().uuid().safeParse(sourceId).success) {
    return { ok: false, error: "知识资料信息不正确，请刷新页面后重试" };
  }
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (!blobToken) return { ok: false, error: "原文件存储尚未配置，暂时无法直接重新解析" };
  try {
    const [source] = await db
      .select({
        id: knowledgeSources.id,
        name: knowledgeSources.name,
        mime: knowledgeSources.mime,
        status: knowledgeSources.status,
        blobPathname: knowledgeSources.blobPathname,
        updatedAt: knowledgeSources.updatedAt,
      })
      .from(knowledgeSources)
      .where(and(
        eq(knowledgeSources.id, sourceId),
        eq(knowledgeSources.workspaceId, DEMO_WORKSPACE_ID),
        isNull(knowledgeSources.archivedAt),
      ))
      .limit(1);
    if (!source) return { ok: false, error: "找不到这份知识资料，请刷新页面后重试" };
    if (source.status !== "failed" && !isKnowledgeParsingStalled(source)) {
      return { ok: false, error: "资料状态已经变化，请刷新页面查看最新状态" };
    }
    if (!source.blobPathname) return { ok: false, error: "这份资料没有保留原文件，请重新上传同一文件" };

    let blob: Awaited<ReturnType<typeof get>>;
    try {
      blob = await get(source.blobPathname, { access: "private", token: blobToken });
    } catch (error) {
      console.error("读取知识原文件以重新解析失败", error);
      return { ok: false, error: "原文件暂时无法读取，请稍后重试或重新上传同一文件" };
    }
    if (!blob?.stream) return { ok: false, error: "原文件不存在或暂时无法读取，请重新上传同一文件" };
    const ingestToken = `pending:${randomUUID()}`;
    const claimed = await db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          id: knowledgeSources.id,
          name: knowledgeSources.name,
          mime: knowledgeSources.mime,
          status: knowledgeSources.status,
          blobPathname: knowledgeSources.blobPathname,
          updatedAt: knowledgeSources.updatedAt,
        })
        .from(knowledgeSources)
        .where(and(
          eq(knowledgeSources.id, sourceId),
          eq(knowledgeSources.workspaceId, DEMO_WORKSPACE_ID),
          isNull(knowledgeSources.archivedAt),
        ))
        .for("update")
        .limit(1);
      if (!current
        || (current.status !== "failed" && !isKnowledgeParsingStalled(current))
        || current.blobPathname !== source.blobPathname) return null;
      await tx
        .update(knowledgeSources)
        .set({ status: "parsing", error: null, parseEngine: ingestToken, updatedAt: new Date() })
        .where(and(eq(knowledgeSources.id, current.id), eq(knowledgeSources.workspaceId, DEMO_WORKSPACE_ID)));
      await tx.insert(auditEvents).values(auditEventValues({
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        action: "knowledge.reingested",
        targetType: "knowledge",
        targetId: current.id,
        summary: `重新解析知识资料「${current.name}」`,
        data: { previousStatus: current.status },
      }));
      return current;
    });
    if (!claimed) {
      await cancelBlobStream(blob.stream);
      return { ok: false, error: "资料状态已经变化，请刷新页面查看最新状态" };
    }
    try {
      await start(knowledgeIngestWorkflow, [{
        sourceId: claimed.id,
        filename: claimed.name,
        mime: claimed.mime,
        content: blob.stream,
        ingestToken,
      }]);
    } catch (error) {
      console.error("知识重新解析工作流启动失败", error);
      await cancelBlobStream(blob.stream);
      await db
        .update(knowledgeSources)
        .set({ status: "failed", error: "解析任务启动失败，请稍后重试", parseEngine: null, updatedAt: new Date() })
        .where(and(
          eq(knowledgeSources.id, claimed.id),
          eq(knowledgeSources.workspaceId, DEMO_WORKSPACE_ID),
          eq(knowledgeSources.parseEngine, ingestToken),
        ));
      return { ok: false, error: "解析任务启动失败，请稍后重试" };
    }
    revalidatePath("/knowledge");
    return { ok: true };
  } catch (error) {
    console.error("重新解析知识资料失败", error);
    return { ok: false, error: "重新解析失败，请稍后重试" };
  }
}
