import { and, desc, eq, isNull } from "drizzle-orm";
import { schedules, agents, agentVersions } from "@/db/schema";
import {
  ScheduleAgentOption,
  type ScheduleAgentOption as ScheduleAgentOptionType,
  ScheduleSpec,
  ScheduleView,
  type ScheduleView as ScheduleViewType,
} from "@/contracts/schedule";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { parseQueryRows } from "@/server/queries/parse-query-rows";

export async function listSchedules(): Promise<ScheduleViewType[]> {
  const rows = await db
    .select({ schedule: schedules, agentName: agents.name })
    .from(schedules)
    .innerJoin(agents, and(eq(schedules.agentId, agents.id), eq(schedules.workspaceId, agents.workspaceId)))
    .where(and(eq(schedules.workspaceId, DEMO_WORKSPACE_ID), isNull(schedules.archivedAt)))
    .orderBy(desc(schedules.createdAt));
  const candidates = rows.flatMap(({ schedule, agentName }) => {
    const spec = ScheduleSpec.safeParse(schedule.spec);
    if (!spec.success) return [];
    return [{
      id: schedule.id, agentId: schedule.agentId, agentName,
      status: schedule.status,
      spec: spec.data,
      nextRunAt: schedule.nextRunAt?.toISOString() ?? null,
      lastError: schedule.lastError,
      consecutiveFailures: schedule.consecutiveFailures,
      createdAt: schedule.createdAt.toISOString(),
    }];
  });
  return parseQueryRows("定时任务列表", ScheduleView, candidates);
}

export async function listScheduleableAgents(): Promise<ScheduleAgentOptionType[]> {
  const rows = await db
    .selectDistinct({ id: agents.id, name: agents.name })
    .from(agents)
    .innerJoin(agentVersions, and(
      eq(agentVersions.agentId, agents.id),
      eq(agentVersions.workspaceId, agents.workspaceId),
      eq(agentVersions.status, "production"),
    ))
    .where(and(eq(agents.workspaceId, DEMO_WORKSPACE_ID), isNull(agents.archivedAt)))
    .orderBy(desc(agents.createdAt));
  return parseQueryRows("定时助手选项", ScheduleAgentOption, rows);
}
