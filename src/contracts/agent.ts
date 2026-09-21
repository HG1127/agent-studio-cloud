import { z } from "zod";

export const AgentCreateInput = z.object({
  name: z.string().min(1).max(60),
  intentText: z.string().min(10).max(2000),
});
export type AgentCreateInput = z.infer<typeof AgentCreateInput>;

export const AgentSummary = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.string(),
  versionCount: z.number().int(),
  updatedAt: z.string(),
});
export type AgentSummary = z.infer<typeof AgentSummary>;
