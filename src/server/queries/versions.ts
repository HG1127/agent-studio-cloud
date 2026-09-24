import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { VersionSummary } from "@/contracts/version";
import { agents, agentVersions } from "@/db/schema";
import { db } from "@/lib/db";

export async function listVersions(agentId: string): Promise<VersionSummary[]> {
  if (!z.string().uuid().safeParse(agentId).success) return [];
  const rows = await db
    .select({
      id: agentVersions.id,
      version: agentVersions.version,
      status: agentVersions.status,
      createdAt: agentVersions.createdAt,
    })
    .from(agentVersions)
    .where(eq(agentVersions.agentId, agentId))
    .orderBy(desc(agentVersions.version));
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
