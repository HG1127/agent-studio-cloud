// 移植旧系统关键词打分口径：命中位置（前 180 字符）加权 + 子串频次；无模型依赖。
const EARLY_POSITION_CHARS = 180;
const EARLY_BONUS = 4;
const FREQUENCY_WEIGHT = 0.5;
const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 20;
const EXCERPT_CHARS = 700;
const MAX_QUERY_CHARS = 1_000;
const MAX_QUERY_TOKENS = 32;
const MAX_TOKEN_CHARS = 200;
const MAX_TRIGRAMS_PER_TOKEN = 32;
export const MAX_KNOWLEDGE_SCAN_CHUNKS = 2_000;

export interface SearchDoc {
  sourceId: string;
  sourceName: string;
  chunkIndex: number;
  content: string;
}

export interface SearchHit {
  sourceId: string;
  sourceName: string;
  chunkIndex: number;
  content: string;
  excerpt: string;
  score: number;
}

export function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .slice(0, MAX_QUERY_CHARS)
    .split(/[\s，。！？、；：""''（）【】\[\]{},.!?;:()<>]+/)
    .map((token) => token.trim().slice(0, MAX_TOKEN_CHARS))
    .filter((token) => token.length > 0)
    .slice(0, MAX_QUERY_TOKENS);
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let position = haystack.indexOf(needle);
  while (position !== -1) {
    count += 1;
    position = haystack.indexOf(needle, position + needle.length);
  }
  return count;
}

export function hanTrigrams(token: string): string[] {
  const grams = new Set<string>();
  for (const match of token.matchAll(/\p{Script=Han}{3,}/gu)) {
    const chars = Array.from(match[0]);
    for (let index = 0; index <= chars.length - 3; index += 1) {
      grams.add(chars.slice(index, index + 3).join(""));
      if (grams.size >= MAX_TRIGRAMS_PER_TOKEN) return [...grams];
    }
  }
  return [...grams];
}

export function knowledgeCandidateTerms(query: string): string[] {
  const terms = new Set<string>();
  for (const token of tokenize(query)) {
    terms.add(token);
    for (const gram of hanTrigrams(token)) terms.add(gram);
  }
  return [...terms];
}

function excerptAroundMatch(content: string, matchIndex: number): string {
  if (content.length <= EXCERPT_CHARS) return content;
  const start = Math.min(
    Math.max(0, matchIndex - Math.floor(EXCERPT_CHARS / 3)),
    content.length - EXCERPT_CHARS,
  );
  return content.slice(start, start + EXCERPT_CHARS);
}

export function scoreChunks(query: string, docs: SearchDoc[], opts?: { limit?: number }): SearchHit[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const terms = tokens.map((token) => ({ token, grams: hanTrigrams(token) }));
  const limit = Math.min(opts?.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const hits: Array<{ hit: SearchHit; exactMatch: boolean }> = [];
  for (const doc of docs) {
    const lower = doc.content.toLowerCase();
    let score = 0;
    let exactMatch = false;
    let firstMatch = Number.POSITIVE_INFINITY;
    for (const { token, grams } of terms) {
      const first = lower.indexOf(token);
      if (first !== -1) {
        exactMatch = true;
        firstMatch = Math.min(firstMatch, first);
        score += FREQUENCY_WEIGHT * countOccurrences(lower, token);
        if (first < EARLY_POSITION_CHARS) score += EARLY_BONUS;
        continue;
      }
      // 中文任务句通常含“检索…资料”等指令词，正文只包含中间的主题短语。
      let earlyGramHit = false;
      for (const gram of grams) {
        const gramFirst = lower.indexOf(gram);
        if (gramFirst === -1) continue;
        firstMatch = Math.min(firstMatch, gramFirst);
        score += FREQUENCY_WEIGHT * countOccurrences(lower, gram);
        if (gramFirst < EARLY_POSITION_CHARS) earlyGramHit = true;
      }
      if (earlyGramHit) score += EARLY_BONUS;
    }
    if (score > 0) {
      hits.push({ hit: { ...doc, excerpt: excerptAroundMatch(doc.content, firstMatch), score }, exactMatch });
    }
  }
  return hits
    .sort((a, b) => Number(b.exactMatch) - Number(a.exactMatch) || b.hit.score - a.hit.score)
    .slice(0, limit)
    .map(({ hit }) => hit);
}
