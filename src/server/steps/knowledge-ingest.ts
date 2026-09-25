"use step";
import mammoth from "mammoth";
import { getDocumentProxy } from "unpdf";
import { FatalError } from "workflow";
import { and, eq } from "drizzle-orm";
import { knowledgeChunks, knowledgeSources } from "@/db/schema";
import { db } from "@/lib/db";
import { chunkText } from "@/server/domain/knowledge/chunker";
import { validateDocxArchive } from "@/server/domain/knowledge/docx-limits";
import { extractHtmlText } from "@/server/domain/knowledge/html-text";
import { decodeKnowledgeText } from "@/server/domain/knowledge/text-decoder";
import {
  MAX_KNOWLEDGE_FILE_BYTES,
  MAX_KNOWLEDGE_PDF_PAGES,
  validateExtractedKnowledgeText,
} from "@/server/domain/knowledge/text-limits";
import { extractBoundedPdfText, KnowledgePdfLimitError } from "@/server/domain/knowledge/pdf-text";
import { processedKnowledgeStatus } from "@/server/domain/knowledge/source-state";
import { redactSensitiveText } from "@/server/domain/security/redact-sensitive";
import { withSafeWorkflowError } from "@/server/security/workflow-error";

interface ParseArgs {
  sourceId: string;
  filename: string;
  mime: string;
  content: ReadableStream<Uint8Array>;
}

function safeKnowledgeParseError(error: unknown, message: string): never {
  if (error instanceof FatalError) throw error;
  if (error instanceof KnowledgePdfLimitError) throw new FatalError(error.message);
  throw new FatalError(message);
}

export async function readKnowledgeFile(content: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = content.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_KNOWLEDGE_FILE_BYTES) {
        await reader.cancel("文件超过大小限制").catch(() => undefined);
        throw new FatalError("文件超过 4MB 限制，请拆分后重新上传");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, totalBytes);
}

export async function parseKnowledgeFile(args: ParseArgs): Promise<{ text: string }> {
  "use step";
  let buffer: Buffer;
  try {
    buffer = await readKnowledgeFile(args.content);
  } catch (error) {
    safeKnowledgeParseError(error, "读取上传文件失败，请重新上传");
  }
  const ext = args.filename.split(".").pop()?.toLowerCase() ?? "";
  let text: string;
  if (ext === "pdf") {
    // unpdf 内置 serverless 版 pdfjs：无 DOMMatrix 依赖，Vercel 函数可直接加载（pdf-parse 会因 browser 条件解析炸掉）
    let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
    try {
      pdf = await getDocumentProxy(new Uint8Array(buffer));
    } catch (error) {
      safeKnowledgeParseError(error, "PDF 文件解析失败，请检查文件是否完整");
    }
    try {
      if (pdf.numPages > MAX_KNOWLEDGE_PDF_PAGES) {
        throw new FatalError(`PDF 超过 ${MAX_KNOWLEDGE_PDF_PAGES} 页限制，请拆分后重新上传`);
      }
      text = await extractBoundedPdfText(pdf);
    } catch (error) {
      safeKnowledgeParseError(error, "PDF 文件解析失败，请检查文件是否完整");
    } finally {
      // 文本已经解析完成时，底层清理失败不应覆盖原有业务结果或安全错误。
      await Promise.resolve(pdf.cleanup()).catch(() => undefined);
    }
  } else if (ext === "docx") {
    const archiveError = validateDocxArchive(buffer);
    if (archiveError) throw new FatalError(archiveError);
    try {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } catch (error) {
      safeKnowledgeParseError(error, "DOCX 文件解析失败，请检查文件是否完整");
    }
  } else if (["txt", "md", "html", "json", "csv", "xml"].includes(ext)) {
    const decoded = decodeKnowledgeText(buffer);
    if (!decoded.ok) throw new FatalError(decoded.error);
    text = ext === "html" ? extractHtmlText(decoded.text) : decoded.text;
  } else {
    throw new FatalError(ext ? `暂不支持解析「${ext}」格式的文件` : "暂不支持解析这种文件格式");
  }
  const textError = validateExtractedKnowledgeText(text);
  if (textError) throw new FatalError(textError);
  return { text };
}

export async function indexKnowledgeChunks(args: { sourceId: string; text: string; ingestToken: string }): Promise<{ chunkCount: number }> {
  "use step";
  const chunks = chunkText(args.text);
  const charCount = chunks.at(-1)?.charEnd ?? 0;
  await withSafeWorkflowError(() => db.transaction(async (tx) => {
    const [source] = await tx
      .select({ workspaceId: knowledgeSources.workspaceId, createdBy: knowledgeSources.createdBy, archivedAt: knowledgeSources.archivedAt, parseEngine: knowledgeSources.parseEngine })
      .from(knowledgeSources)
      .where(eq(knowledgeSources.id, args.sourceId))
      .for("update")
      .limit(1);
    if (!source) throw new FatalError("找不到要入库的知识来源");
    if (source.parseEngine !== args.ingestToken) throw new FatalError("资料已有新的解析任务，忽略旧任务结果");
    // 失败后重新上传会复用同一来源；事务保证旧分片不会被半套新数据覆盖。
    await tx.delete(knowledgeChunks).where(and(
      eq(knowledgeChunks.sourceId, args.sourceId),
      eq(knowledgeChunks.workspaceId, source.workspaceId),
    ));
    for (let i = 0; i < chunks.length; i += 200) {
      const batch = chunks.slice(i, i + 200);
      await tx.insert(knowledgeChunks).values(
        batch.map((chunk) => ({
          workspaceId: source.workspaceId,
          createdBy: source.createdBy,
          sourceId: args.sourceId,
          chunkIndex: chunk.index,
          content: chunk.content,
          charStart: chunk.charStart,
          charEnd: chunk.charEnd,
        })),
      );
    }
    await tx
      .update(knowledgeSources)
      .set({ status: processedKnowledgeStatus(source.archivedAt, "indexed"), chunkCount: chunks.length, charCount, parseEngine: "builtin", error: null, updatedAt: new Date() })
      .where(and(
        eq(knowledgeSources.id, args.sourceId),
        eq(knowledgeSources.workspaceId, source.workspaceId),
      ));
  }), "知识资料暂时无法写入，请稍后重试");
  return { chunkCount: chunks.length };
}

export async function markKnowledgeFailed(args: { sourceId: string; error: string; ingestToken: string }): Promise<void> {
  "use step";
  const safeError = redactSensitiveText(args.error);
  await withSafeWorkflowError(() => db.transaction(async (tx) => {
    const [source] = await tx
      .select({ workspaceId: knowledgeSources.workspaceId, archivedAt: knowledgeSources.archivedAt, parseEngine: knowledgeSources.parseEngine })
      .from(knowledgeSources)
      .where(eq(knowledgeSources.id, args.sourceId))
      .for("update")
      .limit(1);
    if (!source) return;
    if (source.parseEngine !== args.ingestToken) return;
    await tx
      .update(knowledgeSources)
      .set({ status: processedKnowledgeStatus(source.archivedAt, "failed"), parseEngine: "builtin", error: safeError, updatedAt: new Date() })
      .where(and(
        eq(knowledgeSources.id, args.sourceId),
        eq(knowledgeSources.workspaceId, source.workspaceId),
      ));
  }), "知识资料状态暂时无法保存，请稍后重试");
}
