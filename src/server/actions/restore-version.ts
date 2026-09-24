"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AgentManifest } from "@/contracts/manifest";
import { VersionSummary, type RestoreVersionResult } from "@/contracts/version";
import { agentVersions, agents } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { isUniqueViolation } from "@/server/unique-violation";

export async function restoreVersionAction(agentId: string, versionId: string): Promise<RestoreVersionResult> {
  if (!z.string().uuid().safeParse(agentId).success || !z.string().uuid().safeParse(versionId).success) {
    return { ok: false, error: "版本信息不正确，请刷新页面后重试" };
  }
  try {
    const [agent] = await db
      .select({ id: agents.id, workspaceId: agents.workspaceId })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.workspaceId, DEMO_WORKSPACE_ID), isNull(agents.archivedAt)))
      .limit(1);
    if (!agent) return { ok: false, error: "找不到这个助手，请刷新页面后重试" };
    const [source] = await db
      .select({ status: agentVersions.status, manifest: agentVersions.manifest })
      .from(agentVersions)
      .where(and(
        eq(agentVersions.id, versionId),
        eq(agentVersions.agentId, agentId),
        eq(agentVersions.workspaceId, agent.workspaceId),
      ))
      .limit(1);
    if (!source) return { ok: false, error: "找不到这个历史版本，请刷新页面后重试" };
    if (source.status === "production") return { ok: false, error: "这个版本已经是当前版本" };
    const manifest = AgentManifest.safeParse(source.manifest);
    if (!manifest.success) return { ok: false, error: "历史版本格式过旧，无法直接恢复" };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const restoredVersion = await db.transaction(async (tx) => {
          await tx
            .update(agentVersions)
            .set({ status: "retired", updatedAt: new Date() })
            .where(and(eq(agentVersions.agentId, agentId), eq(agentVersions.status, "production")));
          const [row] = await tx
            .select({ maxVersion: sql<number>`coalesce(max(${agentVersions.version}), 0)`.mapWith(Number) })
            .from(agentVersions)
            .where(eq(agentVersions.agentId, agentId));
          const [created] = await tx.insert(agentVersions).values({
            agentId,
            workspaceId: agent.workspaceId,
            createdBy: DEMO_USER_ID,
            version: (row?.maxVersion ?? 0) + 1,
            status: "production",
            manifest: manifest.data,
          }).returning({
            id: agentVersions.id,
            version: agentVersions.version,
            status: agentVersions.status,
            createdAt: agentVersions.createdAt,
          });
          return VersionSummary.parse({ ...created, createdAt: created.createdAt.toISOString() });
        });
        revalidatePath(`/agents/${agentId}`);
        return { ok: true, version: restoredVersion };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        if (attempt > 0) return { ok: false, error: "版本恢复冲突，请重试" };
      }
    }
    return { ok: false, error: "版本恢复冲突，请重试" };
  } catch (error) {
    console.error("恢复版本失败：", error);
    return { ok: false, error: "恢复失败，请稍后重试" };
  }
}
