import { z } from "zod";

export const ToolRegistryOption = z.object({
  id: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).default(""),
  action: z.string().trim().min(1).max(100),
  scope: z.string().trim().min(1).max(100),
  risk: z.enum(["low", "medium", "high"]).default("high"),
  businessIdempotency: z.boolean().optional(),
  businessIdempotencyRetentionMs: z.number().int().min(300_000).max(31_536_000_000).optional(),
  inputSchema: z.record(z.string(), z.unknown()).default({ type: "object" }),
  outputSchema: z.record(z.string(), z.unknown()).default({ type: "object" }),
});
export type ToolRegistryOption = z.infer<typeof ToolRegistryOption>;
