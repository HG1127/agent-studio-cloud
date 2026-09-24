import { z } from "zod";

export const DashboardSummary = z.object({
  activeAgents: z.number().int().nonnegative(),
  publishedAgents: z.number().int().nonnegative(),
  indexedSources: z.number().int().nonnegative(),
  activeRuns: z.number().int().nonnegative(),
  pendingApprovals: z.number().int().nonnegative(),
  runsLast24h: z.number().int().nonnegative(),
  failuresLast24h: z.number().int().nonnegative(),
});
export type DashboardSummary = z.infer<typeof DashboardSummary>;
