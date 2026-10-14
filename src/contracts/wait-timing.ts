import { z } from "zod";

export const MIN_OPERATIONAL_EPOCH_MS = -62135596800000;
export const MAX_OPERATIONAL_EPOCH_MS = 253402300799999;
export const WaitTimingSnapshot = z.object({
  mode: z.enum(["delay", "until", "event"]),
  expectedAtMs: z.number().int().min(-8640000000000000).max(8640000000000000).nullable(),
}).strict().refine((value) => value.mode === "event" || value.expectedAtMs !== null, "定时等待须有预计时间");
export type WaitTimingSnapshot = z.infer<typeof WaitTimingSnapshot>;
