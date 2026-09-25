import { FatalError, RetryableError } from "workflow";
import { indexKnowledgeChunks, markKnowledgeFailed, parseKnowledgeFile } from "@/server/steps/knowledge-ingest";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { safeWorkflowFailureReason } from "@/server/security/workflow-error";

export interface KnowledgeIngestArgs {
  sourceId: string;
  filename: string;
  mime: string;
  content: ReadableStream<Uint8Array>;
  ingestToken: string;
}

export async function knowledgeIngestWorkflow(args: KnowledgeIngestArgs): Promise<{ chunkCount: number }> {
  "use workflow";
  try {
    const parsed = await parseKnowledgeFile(args);
    const indexed = await indexKnowledgeChunks({ sourceId: args.sourceId, text: parsed.text, ingestToken: args.ingestToken });
    return { chunkCount: indexed.chunkCount };
  } catch (err) {
    const reason = safeWorkflowFailureReason(err, "文件解析失败，已停止");
    try {
      await markKnowledgeFailed({ sourceId: args.sourceId, error: reason, ingestToken: args.ingestToken });
    } catch (failErr) {
      console.error(`知识来源 ${args.sourceId} 写失败状态时出错：`, safeErrorForLog(failErr));
    }
    if (err instanceof FatalError || err instanceof RetryableError) throw err;
    console.error(`知识来源 ${args.sourceId} 解析发生未知异常：`, safeErrorForLog(err));
    throw new FatalError(reason);
  }
}
