"use step";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import { FatalError } from "workflow";
import { eq } from "drizzle-orm";
import { knowledgeChunks, knowledgeSources } from "@/db/schema";
import { db } from "@/lib/db";
import { chunkText } from "@/server/domain/knowledge/chunker";

interface ParseArgs {
  sourceId: string;
  filename: string;
  mime: string;
  base64: string;
}

export async function parseKnowledgeFile(args: ParseArgs): Promise<{ text: string }> {
  "use step";
  const buffer = Buffer.from(args.base64, "base64");
  const ext = args.filename.split(".").pop()?.toLowerCase() ?? "";
  let text: string;
  if (ext === "pdf") {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const result = await parser.getText();
      text = result.text;
    } finally {
      await parser.destroy();
    }
  } else if (ext === "docx") {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value;
  } else if (["txt", "md", "html", "json", "csv", "xml"].includes(ext)) {
    text = buffer.toString("utf8");
  } else {
    throw new FatalError(`暂不支持解析「${ext || args.filename}」格式的文件`);
  }
  return { text };
}

export async function indexKnowledgeChunks(args: { sourceId: string; text: string }): Promise<{ chunkCount: number }> {
  "use step";
  const [source] = await db
    .select({ workspaceId: knowledgeSources.workspaceId })
    .from(knowledgeSources)
    .where(eq(knowledgeSources.id, args.sourceId))
    .limit(1);
  if (!source) throw new FatalError("找不到要入库的知识来源");
  const chunks = chunkText(args.text);
  for (let i = 0; i < chunks.length; i += 200) {
    const batch = chunks.slice(i, i + 200);
    await db.insert(knowledgeChunks).values(
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
  const charCount = chunks.reduce((sum, chunk) => sum + chunk.content.length, 0);
  await db
    .update(knowledgeSources)
    .set({ status: "indexed", chunkCount: chunks.length, charCount, parseEngine: "builtin", error: null, updatedAt: new Date() })
    .where(eq(knowledgeSources.id, args.sourceId));
  return { chunkCount: chunks.length };
}

export async function markKnowledgeFailed(args: { sourceId: string; error: string }): Promise<void> {
  "use step";
  await db
    .update(knowledgeSources)
    .set({ status: "failed", error: args.error, updatedAt: new Date() })
    .where(eq(knowledgeSources.id, args.sourceId));
}
