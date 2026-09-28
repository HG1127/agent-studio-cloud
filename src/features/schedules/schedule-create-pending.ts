import { z } from "zod";

export const SCHEDULE_CREATE_PENDING_KEY = "agent-studio:schedule-create-pending";

const ScheduleCreatePending = z.object({
  agentName: z.string().min(1).max(120),
  summary: z.string().min(1).max(300),
  submittedAt: z.iso.datetime(),
});
export type ScheduleCreatePending = z.infer<typeof ScheduleCreatePending>;

export function serializeScheduleCreatePending(pending: ScheduleCreatePending): string {
  return JSON.stringify({ formatVersion: 1, ...pending });
}

export function restoreScheduleCreatePending(raw: string | null): ScheduleCreatePending | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.formatVersion !== 1) return null;
    const result = ScheduleCreatePending.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
