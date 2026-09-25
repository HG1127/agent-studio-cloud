import { hanTrigrams, tokenize } from "@/server/domain/knowledge/search";

export interface MemoryCandidate {
  content: string;
  createdAt: Date;
}

function occurrences(text: string, token: string): number {
  let count = 0;
  let position = text.indexOf(token);
  while (position !== -1) {
    count += 1;
    position = text.indexOf(token, position + token.length);
  }
  return count;
}

export function selectRelevantMemories<T extends MemoryCandidate>(query: string, candidates: T[], limit = 5): T[] {
  const safeLimit = Math.max(1, Math.min(limit, 20));
  const tokens = tokenize(query);
  const newestFirst = [...candidates].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  if (tokens.length === 0) return newestFirst.slice(0, safeLimit);
  return newestFirst
    .map((memory) => {
      const text = memory.content.toLowerCase();
      const score = tokens.reduce((sum, token) => {
        const exact = occurrences(text, token);
        if (exact > 0) return sum + exact * 3;
        return sum + hanTrigrams(token).reduce((subtotal, gram) => subtotal + occurrences(text, gram), 0);
      }, 0);
      return { memory, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.memory.createdAt.getTime() - a.memory.createdAt.getTime())
    .slice(0, safeLimit)
    .map((item) => item.memory);
}
