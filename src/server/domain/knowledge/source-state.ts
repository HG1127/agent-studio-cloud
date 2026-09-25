export const KNOWLEDGE_PARSING_STALE_MS = 5 * 60 * 1000;

export function isKnowledgeParsingStalled(source: { status: string; updatedAt: Date }, now = Date.now()) {
  return source.status === "parsing" && source.updatedAt.getTime() < now - KNOWLEDGE_PARSING_STALE_MS;
}

export function processedKnowledgeStatus(archivedAt: Date | null, outcome: "indexed" | "failed") {
  return archivedAt ? "archived" : outcome;
}

export function restoredKnowledgeStatus(source: { chunkCount: number; error: string | null }) {
  if (source.chunkCount > 0) return "indexed";
  return source.error ? "failed" : "parsing";
}
