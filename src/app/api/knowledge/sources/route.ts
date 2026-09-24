import { createHash } from "node:crypto";
import { put } from "@vercel/blob";
import { and, eq } from "drizzle-orm";
import { start } from "workflow/api";
import { knowledgeSources } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { knowledgeIngestWorkflow } from "@/server/workflows/knowledge-ingest";

export const dynamic = "force-dynamic";

const ALLOWED_EXT = new Set(["pdf", "docx", "txt", "md", "html", "json", "csv", "xml"]);
const MAX_BYTES = 8 * 1024 * 1024;

function toView(row: typeof knowledgeSources.$inferSelect) {
  return {
    id: row.id, name: row.name, mime: row.mime, sizeBytes: row.sizeBytes,
    status: row.status as "parsing" | "indexed" | "failed" | "archived",
    chunkCount: row.chunkCount, charCount: row.charCount, error: row.error,
    hasOriginal: Boolean(row.blobPathname),
    createdAt: row.createdAt.toISOString(),
  };
}

async function storeOriginal(bytes: Buffer, filename: string, sha256: string, token: string): Promise<string> {
  const safeName = filename.replace(/[^\w.\-\u4e00-\u9fff]/g, "_");
  const blob = await put(`knowledge/${DEMO_WORKSPACE_ID}/${sha256}-${safeName}`, bytes, {
    access: "private", addRandomSuffix: true, token,
  });
  return blob.pathname;
}

function storageUnavailable() {
  console.error("[knowledge-upload] 私有文件存储写入失败");
  return Response.json({ ok: false, error: "私有文件存储暂不可用，请检查配置后重试" }, { status: 503 });
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ ok: false, error: "上传内容不是有效的文件表单" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ ok: false, error: "请选择要上传的文件" }, { status: 400 });
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXT.has(ext)) {
    return Response.json({ ok: false, error: "暂不支持这种文件类型，可上传：PDF、DOCX、TXT、MD、HTML、JSON、CSV、XML" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ ok: false, error: "文件超过 8MB 限制，请拆分后再上传" }, { status: 400 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN ?? "";
  const [duplicate] = await db
    .select()
    .from(knowledgeSources)
    .where(and(eq(knowledgeSources.workspaceId, DEMO_WORKSPACE_ID), eq(knowledgeSources.sha256, sha256)))
    .limit(1);
  if (duplicate) {
    let blobPathname = duplicate.blobPathname;
    if (!duplicate.blobPathname && blobToken) {
      try {
        blobPathname = await storeOriginal(bytes, file.name, sha256, blobToken);
      } catch {
        return storageUnavailable();
      }
    }
    const retrying = duplicate.status === "failed"
      || (duplicate.status === "archived" && duplicate.chunkCount === 0 && Boolean(duplicate.error));
    const status = retrying
      ? "parsing"
      : duplicate.status === "archived"
        ? (duplicate.chunkCount > 0 ? "indexed" : "parsing")
        : duplicate.status;
    const error = retrying ? null : duplicate.error;
    if (duplicate.archivedAt || retrying || blobPathname !== duplicate.blobPathname) {
      await db.update(knowledgeSources).set({ archivedAt: null, status, error, blobPathname, updatedAt: new Date() }).where(eq(knowledgeSources.id, duplicate.id));
    }
    if (retrying) {
      try {
        await start(knowledgeIngestWorkflow, [{
          sourceId: duplicate.id,
          filename: file.name,
          mime: file.type || duplicate.mime,
          base64: bytes.toString("base64"),
        }]);
      } catch (startError) {
        console.error("知识重新入库工作流启动失败：", startError);
        await db.update(knowledgeSources).set({ status: "failed", error: "解析任务启动失败，请重新上传", updatedAt: new Date() }).where(eq(knowledgeSources.id, duplicate.id));
        return Response.json({ ok: false, error: "解析任务启动失败，请重新上传" }, { status: 500 });
      }
    }
    return Response.json({
      ok: true,
      deduped: true,
      blobStored: Boolean(blobPathname),
      source: toView({ ...duplicate, archivedAt: null, status, error, blobPathname }),
    });
  }
  let blobPathname: string | null = null;
  if (blobToken) {
    // Blob 只做原文留存（可重解析）；本地/CI 未配 token 时降级跳过，不阻塞入库
    try {
      blobPathname = await storeOriginal(bytes, file.name, sha256, blobToken);
    } catch {
      return storageUnavailable();
    }
  }
  const [row] = await db
    .insert(knowledgeSources)
    .values({
      workspaceId: DEMO_WORKSPACE_ID,
      name: file.name,
      mime: file.type || `application/${ext}`,
      sizeBytes: bytes.length,
      sha256,
      status: "parsing",
      blobPathname,
      createdBy: DEMO_USER_ID,
    })
    .onConflictDoNothing({ target: [knowledgeSources.workspaceId, knowledgeSources.sha256] })
    .returning();
  if (!row) {
    const [concurrent] = await db
      .select()
      .from(knowledgeSources)
      .where(and(eq(knowledgeSources.workspaceId, DEMO_WORKSPACE_ID), eq(knowledgeSources.sha256, sha256)))
      .limit(1);
    if (!concurrent) {
      return Response.json({ ok: false, error: "资料记录创建失败，请稍后重试" }, { status: 500 });
    }
    const effectiveBlobPathname = concurrent.blobPathname ?? blobPathname;
    if (!concurrent.blobPathname && effectiveBlobPathname) {
      await db
        .update(knowledgeSources)
        .set({ blobPathname: effectiveBlobPathname, updatedAt: new Date() })
        .where(eq(knowledgeSources.id, concurrent.id));
    }
    return Response.json({
      ok: true,
      deduped: true,
      blobStored: Boolean(effectiveBlobPathname),
      source: toView({ ...concurrent, blobPathname: effectiveBlobPathname }),
    });
  }
  try {
    await start(knowledgeIngestWorkflow, [{ sourceId: row.id, filename: file.name, mime: row.mime, base64: bytes.toString("base64") }]);
  } catch (error) {
    console.error("知识入库工作流启动失败：", error);
    await db.update(knowledgeSources).set({ status: "failed", error: "解析任务启动失败，请重试上传", updatedAt: new Date() }).where(eq(knowledgeSources.id, row.id));
    return Response.json({ ok: false, error: "解析任务启动失败，请重试上传" }, { status: 500 });
  }
  return Response.json({ ok: true, deduped: false, blobStored: blobPathname !== null, source: toView(row) });
}
