import { sql } from "drizzle-orm";
import { knowledgeChunks } from "@/db/schema";
import { knowledgeCandidateTerms, tokenize } from "@/server/domain/knowledge/search";
import { escapeLikePattern } from "@/server/domain/search-pattern";

function ilikeAny(terms: string[]) {
  const patterns = terms.map((term) => `%${escapeLikePattern(term)}%`);
  if (patterns.length === 0) return sql`false`;
  return sql`${knowledgeChunks.content} ILIKE ANY (ARRAY[${sql.join(patterns.map((pattern) => sql`${pattern}`), sql`, `)}])`;
}

export function knowledgeCandidateFilter(query: string) {
  return ilikeAny(knowledgeCandidateTerms(query));
}

export function knowledgeExactMatchFilter(query: string) {
  return ilikeAny(tokenize(query));
}
