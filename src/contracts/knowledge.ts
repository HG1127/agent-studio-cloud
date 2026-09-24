import { z } from "zod";

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
  createdAt: z.string(),
});
export type KnowledgeSourceView = z.infer<typeof KnowledgeSourceView>;

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
