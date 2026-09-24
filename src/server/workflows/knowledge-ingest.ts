import { indexKnowledgeChunks, markKnowledgeFailed, parseKnowledgeFile } from "@/server/steps/knowledge-ingest";

export interface KnowledgeIngestArgs {
  sourceId: string;
  filename: string;
  mime: string;
  content: ReadableStream<Uint8Array>;
}

export async function knowledgeIngestWorkflow(args: KnowledgeIngestArgs): Promise<{ chunkCount: number }> {
  "use workflow";
  try {
    const parsed = await parseKnowledgeFile(args);
    const indexed = await indexKnowledgeChunks({ sourceId: args.sourceId, text: parsed.text });
    return { chunkCount: indexed.chunkCount };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const reason = /[\u4e00-\u9fff]/.test(message) ? message : "文件解析失败，已停止";
    try {
      await markKnowledgeFailed({ sourceId: args.sourceId, error: reason });
    } catch (failErr) {
      console.error(`知识来源 ${args.sourceId} 写失败状态时出错：`, failErr);
    }
    throw err;
  }
}
