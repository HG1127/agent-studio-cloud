"use step";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { FatalError } from "workflow";
import { eq } from "drizzle-orm";
import { knowledgeChunks, knowledgeSources } from "@/db/schema";
import { db } from "@/lib/db";
import { chunkText } from "@/server/domain/knowledge/chunker";
import { validateExtractedKnowledgeText } from "@/server/domain/knowledge/text-limits";
import { processedKnowledgeStatus } from "@/server/domain/knowledge/source-state";

interface ParseArgs {
  sourceId: string;
  filename: string;
  mime: string;
  content: ReadableStream<Uint8Array>;
}

export async function parseKnowledgeFile(args: ParseArgs): Promise<{ text: string }> {
  "use step";
  const buffer = Buffer.from(await new Response(args.content).arrayBuffer());
  const ext = args.filename.split(".").pop()?.toLowerCase() ?? "";
  let text: string;
  if (ext === "pdf") {
    // unpdf 内置 serverless 版 pdfjs：无 DOMMatrix 依赖，Vercel 函数可直接加载（pdf-parse 会因 browser 条件解析炸掉）
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const result = await extractText(pdf, { mergePages: true });
    text = result.text;
  } else if (ext === "docx") {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else if (["txt", "md", "html", "json", "csv", "xml"].includes(ext)) {
    text = buffer.toString("utf8");
  } else {
    throw new FatalError(`暂不支持解析「${ext || args.filename}」格式的文件`);
  }
  const textError = validateExtractedKnowledgeText(text);
  if (textError) throw new FatalError(textError);
  return { text };
}

export async function indexKnowledgeChunks(args: { sourceId: string; text: string; ingestToken: string }): Promise<{ chunkCount: number }> {
  "use step";
  const chunks = chunkText(args.text);
  const charCount = chunks.reduce((sum, chunk) => sum + chunk.content.length, 0);
  await db.transaction(async (tx) => {
    const [source] = await tx
      .select({ workspaceId: knowledgeSources.workspaceId, archivedAt: knowledgeSources.archivedAt, parseEngine: knowledgeSources.parseEngine })
      .from(knowledgeSources)
      .where(eq(knowledgeSources.id, args.sourceId))
      .for("update")
      .limit(1);
    if (!source) throw new FatalError("找不到要入库的知识来源");
    if (source.parseEngine !== args.ingestToken) throw new FatalError("资料已有新的解析任务，忽略旧任务结果");
    // 失败后重新上传会复用同一来源；事务保证旧分片不会被半套新数据覆盖。
    await tx.delete(knowledgeChunks).where(eq(knowledgeChunks.sourceId, args.sourceId));
    for (let i = 0; i < chunks.length; i += 200) {
      const batch = chunks.slice(i, i + 200);
      await tx.insert(knowledgeChunks).values(
        batch.map((chunk) => ({
          workspaceId: source.workspaceId,
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
      .where(eq(knowledgeSources.id, args.sourceId));
  });
  return { chunkCount: chunks.length };
}

export async function markKnowledgeFailed(args: { sourceId: string; error: string; ingestToken: string }): Promise<void> {
  "use step";
  await db.transaction(async (tx) => {
    const [source] = await tx
      .select({ archivedAt: knowledgeSources.archivedAt, parseEngine: knowledgeSources.parseEngine })
      .from(knowledgeSources)
      .where(eq(knowledgeSources.id, args.sourceId))
      .for("update")
      .limit(1);
    if (!source) return;
    if (source.parseEngine !== args.ingestToken) return;
    await tx
      .update(knowledgeSources)
      .set({ status: processedKnowledgeStatus(source.archivedAt, "failed"), parseEngine: "builtin", error: args.error, updatedAt: new Date() })
      .where(eq(knowledgeSources.id, args.sourceId));
  });
}
