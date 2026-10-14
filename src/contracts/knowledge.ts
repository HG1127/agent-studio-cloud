import { z } from "zod";

export const MAX_KNOWLEDGE_FILENAME_LENGTH = 240;
export const MAX_KNOWLEDGE_QUERY_CHARS = 1_000;
export const KnowledgeQuery = z.union([
  z.string().trim().min(1, "检索内容不能为空").max(MAX_KNOWLEDGE_QUERY_CHARS, "检索内容不能超过 1000 个字符"),
  z.number().transform((value) => String(value)),
]);
export type KnowledgeQuery = z.infer<typeof KnowledgeQuery>;

export const KnowledgeSourceStatus = z.enum(["parsing", "indexed", "failed", "archived"]);
export type KnowledgeSourceStatus = z.infer<typeof KnowledgeSourceStatus>;

export const KnowledgeSourceView = z.object({
  id: z.string().uuid(),
  name: z.string(),
  mime: z.string(),
  sizeBytes: z.number().int(),
  status: KnowledgeSourceStatus,
  chunkCount: z.number().int(),
  charCount: z.number().int(),
  error: z.string().nullable(),
  hasOriginal: z.boolean().optional(),
  parsingStalled: z.boolean().optional(),
  createdAt: z.string(),
});
export type KnowledgeSourceView = z.infer<typeof KnowledgeSourceView>;

export const KnowledgeSearchHit = z.object({
  sourceId: z.string().uuid(),
  sourceName: z.string(),
  chunkIndex: z.number().int().nonnegative(),
  excerpt: z.string(),
  score: z.number(),
});
export type KnowledgeSearchHit = z.infer<typeof KnowledgeSearchHit>;

export const KnowledgeSearchResult = z.object({
  query: z.string(),
  hits: z.array(KnowledgeSearchHit),
  truncated: z.boolean(),
});
export type KnowledgeSearchResult = z.infer<typeof KnowledgeSearchResult>;

export const KnowledgeReceiptHit = KnowledgeSearchHit.pick({ chunkIndex: true, excerpt: true, score: true }).extend({ source: z.string() });
export type KnowledgeReceiptHit = z.infer<typeof KnowledgeReceiptHit>;

export const KnowledgeReceipt = z.object({
  ok: z.literal(true),
  space: z.string(),
  query: z.string(),
  scannedCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
  hitCount: z.number().int().nonnegative(),
  hits: z.array(KnowledgeReceiptHit),
}).refine((receipt) => receipt.hitCount === receipt.hits.length && receipt.hitCount <= receipt.scannedCount, "检索回执数量不一致");
export type KnowledgeReceipt = z.infer<typeof KnowledgeReceipt>;

export const KnowledgeUploadResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), deduped: z.boolean(), blobStored: z.boolean(), source: KnowledgeSourceView }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);

export const KnowledgeArchiveInput = z.object({
  sourceId: z.string().uuid(),
  archived: z.boolean(),
});
export type KnowledgeArchiveInput = z.infer<typeof KnowledgeArchiveInput>;

export const KnowledgeArchiveResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type KnowledgeArchiveResult = z.infer<typeof KnowledgeArchiveResult>;

export const KnowledgeRetryResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type KnowledgeRetryResult = z.infer<typeof KnowledgeRetryResult>;
