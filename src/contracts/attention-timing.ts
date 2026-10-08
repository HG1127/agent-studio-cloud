import { z } from "zod";

export const ATTENTION_LONG_PENDING_MS = 24 * 60 * 60 * 1000;
export const ATTENTION_EXPECTED_GRACE_MS = 30 * 1000;
export const AttentionTimingState = z.enum(["normal", "long-pending", "expected-overdue", "retry-expired", "unknown"]);
export type AttentionTimingState = z.infer<typeof AttentionTimingState>;
export const AttentionTimingSource = z.object({
  waitMode: z.enum(["event", "timer", "none", "unknown"]),
  sinceEpochMs: z.number().finite().nullable(), expectedEpochMs: z.number().finite().nullable(), retryEpochMs: z.number().finite().nullable(),
}).strict();
export type AttentionTimingSource = z.infer<typeof AttentionTimingSource>;
export const AttentionTiming = z.object({
  waitMode: AttentionTimingSource.shape.waitMode, state: AttentionTimingState,
  sinceAt: z.string().datetime().nullable(), expectedAt: z.string().datetime().nullable(), retryDeadline: z.string().datetime().nullable(),
  assessedAt: z.string().datetime(), elapsedSeconds: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
}).strict();
export type AttentionTiming = z.infer<typeof AttentionTiming>;
