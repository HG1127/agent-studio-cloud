import { and, desc, eq, ilike, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { AgentSummary, AgentTargetOption, type AgentTargetOption as AgentTargetOptionType } from "@/contracts/agent";
import { AgentManifest } from "@/contracts/manifest";
import { WorkflowDraft } from "@/contracts/workflow";
import { db } from "@/lib/db";
import { agentVersions, agents, workflowDefinitions } from "@/db/schema";

async function listAgentsByArchivedState(
  workspaceId: string,
  archived: boolean,
  options: { query?: string; limit?: number; offset?: number } = {},
): Promise<AgentSummary[]> {
  const query = options.query?.trim().slice(0, 200);
  const limit = Math.min(101, Math.max(1, options.limit ?? 100));
  const offset = Math.max(0, options.offset ?? 0);
  const rows = await db
    .select({
      id: agents.id,
      name: agents.name,
      description: agents.description,
      status: agents.status,
      archivedAt: agents.archivedAt,
      updatedAt: agents.updatedAt,
      versionCount:
        sql<number>`(select count(*) from ${agentVersions} where ${agentVersions.agentId} = ${agents.id})`.mapWith(
          Number,
        ),
    })
    .from(agents)
    .where(and(
      eq(agents.workspaceId, workspaceId),
      archived ? isNotNull(agents.archivedAt) : isNull(agents.archivedAt),
      query ? or(ilike(agents.name, `%${query}%`), ilike(agents.description, `%${query}%`)) : undefined,
    ))
    .orderBy(desc(agents.updatedAt))
    .limit(limit)
    .offset(offset);
  return rows.map((row) =>
    AgentSummary.parse({
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status ?? "draft",
      versionCount: row.versionCount,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    }),
  );
}

export async function listAgents(workspaceId: string, options?: { query?: string; limit?: number; offset?: number }): Promise<AgentSummary[]> {
  return listAgentsByArchivedState(workspaceId, false, options);
}

export async function listArchivedAgents(workspaceId: string, options?: { query?: string; limit?: number; offset?: number }): Promise<AgentSummary[]> {
  return listAgentsByArchivedState(workspaceId, true, options);
}

export interface AgentDetail {
  agent: typeof agents.$inferSelect;
  draft: WorkflowDraft | null;
  currentVersion: typeof agentVersions.$inferSelect | null;
}

export async function getAgentDetail(agentId: string, workspaceId: string): Promise<AgentDetail | null> {
  if (!z.string().uuid().safeParse(agentId).success) return null;
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), isNull(agents.archivedAt), eq(agents.workspaceId, workspaceId)))
    .limit(1);
  if (!agent) return null;
  const [definition] = await db
    .select({ draft: workflowDefinitions.draft })
    .from(workflowDefinitions)
    .where(eq(workflowDefinitions.agentId, agentId))
    .orderBy(desc(workflowDefinitions.createdAt))
    .limit(1);
  const [currentVersion] = await db
    .select()
    .from(agentVersions)
    .where(and(
      eq(agentVersions.agentId, agentId),
      eq(agentVersions.workspaceId, workspaceId),
      eq(agentVersions.status, "production"),
    ))
    .orderBy(desc(agentVersions.version))
    .limit(1);
  // 草稿写入时已过契约校验；读取再 safeParse 一次，坏数据降级为空草稿而不是让页面崩掉
  const parsed = definition ? WorkflowDraft.safeParse(definition.draft) : null;
  return { agent, draft: parsed?.success ? parsed.data : null, currentVersion: currentVersion ?? null };
}

export async function listAgentTargets(workspaceId: string, excludeAgentId: string): Promise<AgentTargetOptionType[]> {
  const rows = await db
    .select({ agentId: agents.id, agentName: agents.name, versionId: agentVersions.id, version: agentVersions.version, manifest: agentVersions.manifest })
    .from(agentVersions)
    .innerJoin(agents, eq(agents.id, agentVersions.agentId))
    .where(and(eq(agentVersions.workspaceId, workspaceId), eq(agentVersions.status, "production"), isNull(agents.archivedAt)))
    .orderBy(desc(agentVersions.version));
  return rows.flatMap((row) => {
    if (row.agentId === excludeAgentId) return [];
    const manifest = AgentManifest.safeParse(row.manifest);
    if (!manifest.success) return [];
    return [AgentTargetOption.parse({
      agentId: row.agentId,
      agentName: row.agentName,
      versionId: row.versionId,
      version: row.version,
      inputContract: manifest.data.inputContract,
      outputContract: manifest.data.outputContract ?? { fields: [] },
    })];
  });
}
