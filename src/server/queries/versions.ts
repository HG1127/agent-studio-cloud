import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { VersionSummary } from "@/contracts/version";
import { agents, agentVersions } from "@/db/schema";
import { db } from "@/lib/db";

export async function listVersions(agentId: string, pagination: { limit?: number; offset?: number } = {}): Promise<VersionSummary[]> {
  if (!z.string().uuid().safeParse(agentId).success) return [];
  const limit = Math.min(101, Math.max(1, pagination.limit ?? 100));
  const offset = Math.max(0, pagination.offset ?? 0);
  const rows = await db
    .select({
      id: agentVersions.id,
      version: agentVersions.version,
      status: agentVersions.status,
      createdAt: agentVersions.createdAt,
    })
    .from(agentVersions)
    .where(eq(agentVersions.agentId, agentId))
    .orderBy(desc(agentVersions.version))
    .limit(limit)
    .offset(offset);
  return rows.map((row) =>
    VersionSummary.parse({
      id: row.id,
      version: row.version,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
    }),
  );
}

export async function getVersionExportSource(agentId: string, versionId: string, workspaceId: string) {
  if (!z.string().uuid().safeParse(agentId).success || !z.string().uuid().safeParse(versionId).success) return null;
  const [row] = await db
    .select({
      agentName: agents.name,
      version: agentVersions.version,
      status: agentVersions.status,
      manifest: agentVersions.manifest,
      createdAt: agentVersions.createdAt,
    })
    .from(agentVersions)
    .innerJoin(agents, eq(agents.id, agentVersions.agentId))
    .where(and(
      eq(agentVersions.id, versionId),
      eq(agentVersions.agentId, agentId),
      eq(agentVersions.workspaceId, workspaceId),
      eq(agents.workspaceId, workspaceId),
    ))
    .limit(1);
  return row ?? null;
}

export async function getVersionComparisonSource(agentId: string, versionIds: [string, string], workspaceId: string) {
  const uuid = z.string().uuid();
  if (!uuid.safeParse(agentId).success || versionIds.some((id) => !uuid.safeParse(id).success) || versionIds[0] === versionIds[1]) {
    return null;
  }
  const rows = await db
    .select({
      id: agentVersions.id,
      agentName: agents.name,
      version: agentVersions.version,
      status: agentVersions.status,
      manifest: agentVersions.manifest,
    })
    .from(agentVersions)
    .innerJoin(agents, eq(agents.id, agentVersions.agentId))
    .where(and(
      eq(agentVersions.agentId, agentId),
      inArray(agentVersions.id, versionIds),
      eq(agentVersions.workspaceId, workspaceId),
      eq(agents.workspaceId, workspaceId),
    ));
  if (rows.length !== 2) return null;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const before = byId.get(versionIds[0]);
  const after = byId.get(versionIds[1]);
  return before && after ? { agentName: before.agentName, before, after } : null;
}
