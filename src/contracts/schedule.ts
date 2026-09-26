import { z } from "zod";
import { RunInputPayload } from "./run";

const TimeSlot = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "时间格式应为 HH:MM");
const TimeSlots = z.array(TimeSlot).min(1).max(5);

export const ScheduleSpec = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("once"), at: z.iso.datetime() }),
  z.object({ kind: z.literal("interval"), minutes: z.number().int().min(5) }),
  z.object({ kind: z.literal("daily"), times: TimeSlots }),
  z.object({ kind: z.literal("weekly"), weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7), times: TimeSlots }),
  z.object({ kind: z.literal("monthly"), days: z.array(z.number().int().min(1).max(28)).min(1).max(28), times: TimeSlots }),
]);
export type ScheduleSpec = z.infer<typeof ScheduleSpec>;

export const ScheduleCreateInput = z.object({
  agentId: z.string().uuid(),
  spec: ScheduleSpec,
  input: RunInputPayload.default({}),
});
export type ScheduleCreateInput = z.infer<typeof ScheduleCreateInput>;

export const ScheduleAgentOption = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
});
export type ScheduleAgentOption = z.infer<typeof ScheduleAgentOption>;

export const ScheduleView = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  agentName: z.string(),
  status: z.enum(["active", "paused", "error", "archived"]),
  spec: ScheduleSpec,
  nextRunAt: z.string().nullable(),
  lastError: z.string().nullable(),
  consecutiveFailures: z.number().int(),
  createdAt: z.string(),
});
export type ScheduleView = z.infer<typeof ScheduleView>;
