export const KNOWLEDGE_PARSING_STALE_MS = 5 * 60 * 1000;
export const KNOWLEDGE_START_UNCONFIRMED_ERROR = "解析任务启动状态未确认，资料已保存；请稍后刷新，若长时间未完成请重试";

export function isKnowledgeParsingStalled(source: { status: string; updatedAt?: Date | null }, now = Date.now()) {
  if (source.status !== "parsing" || !(source.updatedAt instanceof Date)) return false;

  const updatedAt = source.updatedAt.getTime();
  return Number.isFinite(updatedAt) && updatedAt < now - KNOWLEDGE_PARSING_STALE_MS;
}

export function processedKnowledgeStatus(archivedAt: Date | null, outcome: "indexed" | "failed") {
  return archivedAt ? "archived" : outcome;
}

export function restoredKnowledgeStatus(source: { chunkCount: number; error: string | null }) {
  if (source.chunkCount > 0) return "indexed";
  return source.error ? "failed" : "parsing";
}
