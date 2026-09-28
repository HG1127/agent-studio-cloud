import { and, desc, eq, isNull } from "drizzle-orm";
import { schedules, agents, agentVersions } from "@/db/schema";
import { AgentManifest } from "@/contracts/manifest";
import { ScheduleAgentOption, ScheduleSpec, type ScheduleAgentOption as ScheduleAgentOptionType, type ScheduleView } from "@/contracts/schedule";
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

export async function listScheduleableAgents(): Promise<ScheduleAgentOptionType[]> {
  const rows = await db
    .select({ id: agents.id, name: agents.name, version: agentVersions.version, manifest: agentVersions.manifest })
    .from(agentVersions)
    .innerJoin(agents, eq(agents.id, agentVersions.agentId))
    .where(and(
      eq(agentVersions.workspaceId, DEMO_WORKSPACE_ID),
      eq(agentVersions.status, "production"),
      eq(agents.workspaceId, DEMO_WORKSPACE_ID),
      isNull(agents.archivedAt),
    ))
    .orderBy(desc(agentVersions.version));
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    if (seen.has(row.id)) return [];
    const manifest = AgentManifest.safeParse(row.manifest);
    if (!manifest.success) return [];
    const option = ScheduleAgentOption.safeParse({
      id: row.id,
      name: row.name,
      version: row.version,
      inputContract: manifest.data.inputContract,
    });
    if (!option.success) return [];
    seen.add(row.id);
    return [option.data];
  });
}
