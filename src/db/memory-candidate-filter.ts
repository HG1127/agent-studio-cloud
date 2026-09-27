import { sql } from "drizzle-orm";
import { agentMemories } from "@/db/schema";
import { tokenize } from "@/server/domain/knowledge/search";
import { memoryCandidateTerms } from "@/server/domain/memory/memory-search";
import { escapeLikePattern } from "@/server/domain/search-pattern";

function ilikeAny(terms: string[]) {
  const patterns = terms.map((term) => `%${escapeLikePattern(term)}%`);
  return sql`${agentMemories.content} ILIKE ANY (ARRAY[${sql.join(patterns.map((pattern) => sql`${pattern}`), sql`, `)}])`;
}

export function memoryCandidateFilter(query: string) {
  const terms = memoryCandidateTerms(query);
  return terms.length > 0 ? ilikeAny(terms) : undefined;
}

export function memoryExactMatchFilter(query: string) {
  const terms = tokenize(query);
  return terms.length > 0 ? ilikeAny(terms) : undefined;
}
