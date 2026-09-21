import { z } from "zod";

export const RunStartInput = z.object({
  agentId: z.string().uuid(),
  input: z.record(z.string(), z.unknown()).default({}),
});
export type RunStartInput = z.infer<typeof RunStartInput>;

export const RunView = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  agentName: z.string(),
  status: z.enum(["queued", "running", "waiting_approval", "completed", "failed", "cancelled"]),
  input: z.record(z.string(), z.unknown()),
  result: z.unknown().nullable(),
  error: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type RunView = z.infer<typeof RunView>;

export const TraceEventView = z.object({
  id: z.string().uuid(),
  seq: z.number().int(),
  nodeId: z.string().nullable(),
  kind: z.string(),
  level: z.enum(["info", "warn", "error"]),
  title: z.string(),
  detail: z.string().nullable(),
  at: z.string(),
});
export type TraceEventView = z.infer<typeof TraceEventView>;

export const ApprovalView = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  nodeId: z.string(),
  nodeTitle: z.string(),
  status: z.enum(["pending", "approved", "rejected"]),
  role: z.string(),
  reason: z.string(),
  decidedAt: z.string().nullable(),
});
export type ApprovalView = z.infer<typeof ApprovalView>;

export const ApprovalDecisionInput = z.object({
  decision: z.enum(["approved", "rejected"]),
  note: z.string().max(500).optional(),
});
export type ApprovalDecisionInput = z.infer<typeof ApprovalDecisionInput>;
