import { get } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { knowledgeSources } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ sourceId: string }> }) {
  const parsed = z.string().uuid().safeParse((await context.params).sourceId);
  if (!parsed.success) return Response.json({ ok: false, error: "资料信息不正确" }, { status: 400 });
  const [source] = await db
    .select({ name: knowledgeSources.name, mime: knowledgeSources.mime, blobPathname: knowledgeSources.blobPathname })
    .from(knowledgeSources)
    .where(and(eq(knowledgeSources.id, parsed.data), eq(knowledgeSources.workspaceId, DEMO_WORKSPACE_ID)))
    .limit(1);
  if (!source) return Response.json({ ok: false, error: "找不到这份资料" }, { status: 404 });
  if (!source.blobPathname) return Response.json({ ok: false, error: "这份资料没有保留原文件" }, { status: 404 });
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return Response.json({ ok: false, error: "原文件存储尚未配置" }, { status: 503 });
  try {
    const blob = await get(source.blobPathname, { access: "private", token });
    if (!blob?.stream) return Response.json({ ok: false, error: "原文件不存在或暂时无法读取" }, { status: 404 });
    return new Response(blob.stream, {
      headers: {
        "content-type": blob.blob.contentType || source.mime || "application/octet-stream",
        "content-length": String(blob.blob.size ?? ""),
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(source.name)}`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("读取知识原文件失败", error);
    return Response.json({ ok: false, error: "原文件暂时无法读取，请稍后重试" }, { status: 503 });
  }
}
