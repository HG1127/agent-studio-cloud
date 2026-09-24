import { z } from "zod";

export const MemoryView = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  agentName: z.string(),
  sourceRunId: z.string().uuid(),
  sourceNodeTitle: z.string(),
  content: z.string(),
  createdAt: z.string(),
  archivedAt: z.string().nullable(),
});
export type MemoryView = z.infer<typeof MemoryView>;

export const MemoryAgentOption = z.object({ id: z.string().uuid(), name: z.string() });
export type MemoryAgentOption = z.infer<typeof MemoryAgentOption>;

export const MemoryArchiveInput = z.object({ memoryId: z.string().uuid(), archived: z.boolean() });
export type MemoryArchiveInput = z.infer<typeof MemoryArchiveInput>;

export const MemoryArchiveResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type MemoryArchiveResult = z.infer<typeof MemoryArchiveResult>;
