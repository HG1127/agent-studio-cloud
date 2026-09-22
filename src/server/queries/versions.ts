import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { VersionSummary } from "@/contracts/version";
import { agentVersions } from "@/db/schema";
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
