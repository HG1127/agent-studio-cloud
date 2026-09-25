import { createHash, randomUUID } from "node:crypto";
import { del, put } from "@vercel/blob";
import { and, eq, isNull } from "drizzle-orm";
import { start } from "workflow/api";
import { MAX_KNOWLEDGE_FILENAME_LENGTH } from "@/contracts/knowledge";
import { auditEvents, knowledgeSources } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import {
  MAX_KNOWLEDGE_FILE_BYTES,
  MAX_KNOWLEDGE_MIME_LENGTH,
} from "@/server/domain/knowledge/text-limits";
import { knowledgeIngestWorkflow } from "@/server/workflows/knowledge-ingest";
import { auditEventValues } from "@/server/audit/event-values";
import { isKnowledgeParsingStalled } from "@/server/domain/knowledge/source-state";
import { hasCrossSiteOrigin } from "@/server/security/request-origin";
import { redactSensitiveText } from "@/server/domain/security/redact-sensitive";

export const dynamic = "force-dynamic";

const ALLOWED_EXT = new Set(["pdf", "docx", "txt", "md", "html", "json", "csv", "xml"]);
const MAX_MULTIPART_BYTES = 5 * 1024 * 1024;

function toView(row: typeof knowledgeSources.$inferSelect) {
  return {
    id: row.id, name: row.name, mime: row.mime, sizeBytes: row.sizeBytes,
    status: row.status as "parsing" | "indexed" | "failed" | "archived",
    chunkCount: row.chunkCount, charCount: row.charCount, error: row.error ? redactSensitiveText(row.error) : null,
    hasOriginal: Boolean(row.blobPathname),
    parsingStalled: isKnowledgeParsingStalled(row),
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

async function removeUnusedOriginal(pathname: string | null, retainedPathname: string | null, token: string): Promise<void> {
  if (!pathname || pathname === retainedPathname) return;
  try {
    await del(pathname, { token });
  } catch (error) {
    console.error("[knowledge-upload] 清理未采用的并发上传文件失败", error);
  }
}

function storageUnavailable() {
  console.error("[knowledge-upload] 私有文件存储写入失败");
  return Response.json({ ok: false, error: "私有文件存储暂不可用，请检查配置后重试" }, { status: 503 });
}

async function reconcileDuplicateSource(sourceId: string, suppliedBlobPathname: string | null) {
  return db.transaction(async (tx) => {
    // 重新锁定并读取，避免两个失败重传请求都基于锁外的旧状态启动解析任务。
    const [current] = await tx
      .select()
      .from(knowledgeSources)
      .where(and(eq(knowledgeSources.id, sourceId), eq(knowledgeSources.workspaceId, DEMO_WORKSPACE_ID)))
      .for("update")
      .limit(1);
    if (!current) return null;
    const staleParsing = isKnowledgeParsingStalled(current);
    const retrying = current.status === "failed" || staleParsing
      || (current.status === "archived" && current.chunkCount === 0);
    const status = retrying
      ? "parsing"
      : current.status === "archived"
        ? (current.chunkCount > 0 ? "indexed" : "parsing")
        : current.status;
    const error = retrying ? null : current.error;
    const ingestToken = retrying ? `pending:${randomUUID()}` : null;
    const blobPathname = current.blobPathname ?? suppliedBlobPathname;
    const shouldUpdate = Boolean(current.archivedAt) || retrying || blobPathname !== current.blobPathname;
    if (shouldUpdate) {
      await tx
        .update(knowledgeSources)
        .set({ archivedAt: null, status, error, blobPathname, parseEngine: ingestToken ?? current.parseEngine, updatedAt: new Date() })
        .where(and(eq(knowledgeSources.id, current.id), eq(knowledgeSources.workspaceId, DEMO_WORKSPACE_ID)));
      if (current.archivedAt) {
        await tx.insert(auditEvents).values(auditEventValues({
          workspaceId: DEMO_WORKSPACE_ID,
          createdBy: DEMO_USER_ID,
          action: "knowledge.restored",
          targetType: "knowledge",
          targetId: current.id,
          summary: `通过重新上传恢复知识资料「${current.name}」`,
          data: {},
        }));
      }
      if (retrying) {
        await tx.insert(auditEvents).values(auditEventValues({
          workspaceId: DEMO_WORKSPACE_ID,
          createdBy: DEMO_USER_ID,
          action: "knowledge.reingested",
          targetType: "knowledge",
          targetId: current.id,
          summary: `重新解析知识资料「${current.name}」`,
          data: { previousStatus: current.status },
        }));
      }
    }
    return { row: { ...current, archivedAt: null, status, error, blobPathname, parseEngine: ingestToken ?? current.parseEngine }, retrying, ingestToken };
  });
}

export async function POST(req: Request) {
  if (hasCrossSiteOrigin(req)) {
    return Response.json({ ok: false, error: "不允许从其他站点提交资料" }, { status: 403 });
  }
  const declaredLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MULTIPART_BYTES) {
    return Response.json({ ok: false, error: "上传请求过大，文件请保持在 4MB 以内" }, { status: 413 });
  }
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
  if (file.size === 0) {
    return Response.json({ ok: false, error: "文件内容为空，请选择有效文件" }, { status: 400 });
  }
  if (file.name.length > MAX_KNOWLEDGE_FILENAME_LENGTH) {
    return Response.json({ ok: false, error: `文件名不能超过 ${MAX_KNOWLEDGE_FILENAME_LENGTH} 个字符` }, { status: 400 });
  }
  if (file.type.length > MAX_KNOWLEDGE_MIME_LENGTH) {
    return Response.json({ ok: false, error: "文件类型信息过长，请重新选择文件" }, { status: 400 });
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXT.has(ext)) {
    return Response.json({ ok: false, error: "暂不支持这种文件类型，可上传：PDF、DOCX、TXT、MD、HTML、JSON、CSV、XML" }, { status: 400 });
  }
  if (file.size > MAX_KNOWLEDGE_FILE_BYTES) {
    return Response.json({ ok: false, error: "文件超过 4MB 限制，请拆分后再上传" }, { status: 400 });
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
    let uploadedBlobPathname: string | null = null;
    if (!duplicate.blobPathname && blobToken) {
      try {
        uploadedBlobPathname = await storeOriginal(bytes, file.name, sha256, blobToken);
        blobPathname = uploadedBlobPathname;
      } catch {
        return storageUnavailable();
      }
    }
    let reconciled: Awaited<ReturnType<typeof reconcileDuplicateSource>>;
    try {
      reconciled = await reconcileDuplicateSource(duplicate.id, blobPathname);
    } catch (error) {
      await removeUnusedOriginal(uploadedBlobPathname, null, blobToken);
      throw error;
    }
    if (!reconciled) {
      await removeUnusedOriginal(uploadedBlobPathname, null, blobToken);
      return Response.json({ ok: false, error: "资料记录已经不存在，请重新上传" }, { status: 409 });
    }
    await removeUnusedOriginal(uploadedBlobPathname, reconciled.row.blobPathname, blobToken);
    if (reconciled.retrying) {
      try {
        await start(knowledgeIngestWorkflow, [{
          sourceId: duplicate.id,
          filename: file.name,
          mime: file.type || duplicate.mime,
          content: new Blob([bytes]).stream(),
          ingestToken: reconciled.ingestToken!,
        }]);
      } catch (startError) {
        console.error("知识重新入库工作流启动失败：", startError);
        await db.update(knowledgeSources).set({ status: "failed", error: "解析任务启动失败，请重新上传", parseEngine: null, updatedAt: new Date() }).where(and(
          eq(knowledgeSources.id, duplicate.id), eq(knowledgeSources.parseEngine, reconciled.ingestToken!),
        ));
        return Response.json({ ok: false, error: "解析任务启动失败，请重新上传" }, { status: 500 });
      }
    }
    return Response.json({
      ok: true,
      deduped: true,
      blobStored: Boolean(reconciled.row.blobPathname),
      source: toView(reconciled.row),
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
  const ingestToken = `pending:${randomUUID()}`;
  let row: typeof knowledgeSources.$inferSelect | null;
  try {
    row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(knowledgeSources)
        .values({
          workspaceId: DEMO_WORKSPACE_ID,
          name: file.name,
          mime: file.type || `application/${ext}`,
          sizeBytes: bytes.length,
          sha256,
          status: "parsing",
          parseEngine: ingestToken,
          blobPathname,
          createdBy: DEMO_USER_ID,
        })
        .onConflictDoNothing({ target: [knowledgeSources.workspaceId, knowledgeSources.sha256] })
        .returning();
      if (!created) return null;
      await tx.insert(auditEvents).values(auditEventValues({
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        action: "knowledge.uploaded",
        targetType: "knowledge",
        targetId: created.id,
        summary: `上传知识资料「${created.name}」`,
        data: { sizeBytes: created.sizeBytes, originalStored: Boolean(created.blobPathname) },
      }));
      return created;
    });
  } catch (error) {
    await removeUnusedOriginal(blobPathname, null, blobToken);
    throw error;
  }
  if (!row) {
    const [concurrent] = await db
      .select()
      .from(knowledgeSources)
      .where(and(eq(knowledgeSources.workspaceId, DEMO_WORKSPACE_ID), eq(knowledgeSources.sha256, sha256)))
      .limit(1);
    if (!concurrent) {
      await removeUnusedOriginal(blobPathname, null, blobToken);
      return Response.json({ ok: false, error: "资料记录创建失败，请稍后重试" }, { status: 500 });
    }
    let effectiveBlobPathname = concurrent.blobPathname;
    if (!effectiveBlobPathname && blobPathname) {
      const [adopted] = await db
        .update(knowledgeSources)
        .set({ blobPathname, updatedAt: new Date() })
        .where(and(
          eq(knowledgeSources.id, concurrent.id),
          eq(knowledgeSources.workspaceId, DEMO_WORKSPACE_ID),
          isNull(knowledgeSources.blobPathname),
        ))
        .returning({ blobPathname: knowledgeSources.blobPathname });
      if (adopted?.blobPathname) {
        effectiveBlobPathname = adopted.blobPathname;
      } else {
        const [latest] = await db
          .select({ blobPathname: knowledgeSources.blobPathname })
          .from(knowledgeSources)
          .where(and(eq(knowledgeSources.id, concurrent.id), eq(knowledgeSources.workspaceId, DEMO_WORKSPACE_ID)))
          .limit(1);
        effectiveBlobPathname = latest?.blobPathname ?? null;
      }
    }
    await removeUnusedOriginal(blobPathname, effectiveBlobPathname, blobToken);
    return Response.json({
      ok: true,
      deduped: true,
      blobStored: Boolean(effectiveBlobPathname),
      source: toView({ ...concurrent, blobPathname: effectiveBlobPathname }),
    });
  }
  try {
    await start(knowledgeIngestWorkflow, [{ sourceId: row.id, filename: file.name, mime: row.mime, content: new Blob([bytes]).stream(), ingestToken }]);
  } catch (error) {
    console.error("知识入库工作流启动失败：", error);
    await db.update(knowledgeSources).set({ status: "failed", error: "解析任务启动失败，请重试上传", parseEngine: null, updatedAt: new Date() }).where(and(
      eq(knowledgeSources.id, row.id), eq(knowledgeSources.parseEngine, ingestToken),
    ));
    return Response.json({ ok: false, error: "解析任务启动失败，请重试上传" }, { status: 500 });
  }
  return Response.json({ ok: true, deduped: false, blobStored: blobPathname !== null, source: toView(row) });
}
