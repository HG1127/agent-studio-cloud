import { get } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { knowledgeSources } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { queryUnavailableResponse, SafeQueryError, withSafeQueryError } from "@/server/security/query-error";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ sourceId: string }> }) {
  const parsed = z.string().uuid().safeParse((await context.params).sourceId);
  if (!parsed.success) return Response.json({ ok: false, error: "资料信息不正确" }, { status: 400 });
  let source: { name: string; mime: string; blobPathname: string | null } | undefined;
  try {
    [source] = await withSafeQueryError(() => db
      .select({ name: knowledgeSources.name, mime: knowledgeSources.mime, blobPathname: knowledgeSources.blobPathname })
      .from(knowledgeSources)
      .where(and(eq(knowledgeSources.id, parsed.data), eq(knowledgeSources.workspaceId, DEMO_WORKSPACE_ID)))
      .limit(1), "knowledge-file");
  } catch (error) {
    if (error instanceof SafeQueryError) return queryUnavailableResponse();
    throw error;
  }
  if (!source) return Response.json({ ok: false, error: "找不到这份资料" }, { status: 404 });
  if (!source.blobPathname) return Response.json({ ok: false, error: "这份资料没有保留原文件" }, { status: 404 });
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return Response.json({ ok: false, error: "原文件存储尚未配置" }, { status: 503 });
  try {
    const blob = await get(source.blobPathname, { access: "private", token });
    if (!blob?.stream) return Response.json({ ok: false, error: "原文件不存在或暂时无法读取" }, { status: 404 });
    const headers = new Headers({
      "content-type": source.mime || blob.blob.contentType || "application/octet-stream",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(source.name)}`,
      "cache-control": "private, no-store",
    });
    if (typeof blob.blob.size === "number" && Number.isFinite(blob.blob.size) && blob.blob.size >= 0) {
      headers.set("content-length", String(blob.blob.size));
    }
    return new Response(blob.stream, {
      headers,
    });
  } catch (error) {
    console.error("读取知识原文件失败", safeErrorForLog(error));
    return Response.json({ ok: false, error: "原文件暂时无法读取，请稍后重试" }, { status: 503 });
  }
}
