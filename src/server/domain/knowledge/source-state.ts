export function processedKnowledgeStatus(archivedAt: Date | null, outcome: "indexed" | "failed") {
  return archivedAt ? "archived" : outcome;
}

export function restoredKnowledgeStatus(source: { chunkCount: number; error: string | null }) {
  if (source.chunkCount > 0) return "indexed";
  return source.error ? "failed" : "parsing";
}
