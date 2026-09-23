import { and, desc, eq, isNull } from "drizzle-orm";
import { schedules, agents } from "@/db/schema";
import { ScheduleSpec, type ScheduleView } from "@/contracts/schedule";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";

export async function listSchedules(): Promise<ScheduleView[]> {
  const rows = await db
    .select({ schedule: schedules, agentName: agents.name })
    .from(schedules)
    .innerJoin(agents, eq(schedules.agentId, agents.id))
    .where(and(eq(schedules.workspaceId, DEMO_WORKSPACE_ID), isNull(schedules.archivedAt)))
    .orderBy(desc(schedules.createdAt));
  return rows.flatMap(({ schedule, agentName }) => {
    const spec = ScheduleSpec.safeParse(schedule.spec);
    if (!spec.success) return [];
    return [{
      id: schedule.id, agentId: schedule.agentId, agentName,
      status: schedule.status as ScheduleView["status"],
      spec: spec.data,
      nextRunAt: schedule.nextRunAt?.toISOString() ?? null,
      lastError: schedule.lastError,
      consecutiveFailures: schedule.consecutiveFailures,
      createdAt: schedule.createdAt.toISOString(),
    }];
  });
}

export async function listScheduleableAgents(): Promise<{ id: string; name: string }[]> {
  const rows = await db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(and(eq(agents.workspaceId, DEMO_WORKSPACE_ID), isNull(agents.archivedAt)))
    .orderBy(desc(agents.createdAt));
  return rows;
}
