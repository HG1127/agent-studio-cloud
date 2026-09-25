"use server";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AgentManifest } from "@/contracts/manifest";
import { VersionSummary, type RestoreVersionResult } from "@/contracts/version";
import { agentVersions, agents, auditEvents, knowledgeSources } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { isUniqueViolation } from "@/server/unique-violation";
import { auditEventValues } from "@/server/audit/event-values";
import { bindWorkflowRootAgent } from "@/server/domain/workflow-root-agent";
import { knowledgeStepTitles, validateKnowledgeSnapshot } from "@/server/domain/runtime/knowledge-snapshot";

export async function restoreVersionAction(agentId: string, versionId: string): Promise<RestoreVersionResult> {
  if (!z.string().uuid().safeParse(agentId).success || !z.string().uuid().safeParse(versionId).success) {
    return { ok: false, error: "版本信息不正确，请刷新页面后重试" };
  }
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const restoreOutcome = await db.transaction(async (tx) => {
          // 与发布、流程保存和改名共用助手行锁，保证恢复时看到的是同一时刻的名称与版本状态。
          const [agent] = await tx
            .select({ id: agents.id, name: agents.name, workspaceId: agents.workspaceId })
            .from(agents)
            .where(and(eq(agents.id, agentId), eq(agents.workspaceId, DEMO_WORKSPACE_ID), isNull(agents.archivedAt)))
            .for("update")
            .limit(1);
          if (!agent) return { kind: "agent-missing" as const };
          const [source] = await tx
            .select({ version: agentVersions.version, status: agentVersions.status, manifest: agentVersions.manifest })
            .from(agentVersions)
            .where(and(
              eq(agentVersions.id, versionId),
              eq(agentVersions.agentId, agentId),
              eq(agentVersions.workspaceId, agent.workspaceId),
            ))
            .for("update")
            .limit(1);
          if (!source) return { kind: "source-missing" as const };
          if (source.status === "production") return { kind: "already-production" as const };
          if (source.status !== "retired") return { kind: "source-not-retired" as const };
          const manifest = AgentManifest.safeParse(source.manifest);
          if (!manifest.success) return { kind: "manifest-invalid" as const };
          const knowledgeTitles = knowledgeStepTitles(manifest.data.workflowSnapshot.nodes);
          if (knowledgeTitles.length > 0) {
            const snapshotSourceIds = manifest.data.knowledgeSnapshot;
            const availableSources = snapshotSourceIds.length > 0
              ? await tx
                  .select({ id: knowledgeSources.id })
                  .from(knowledgeSources)
                  .where(and(
                    inArray(knowledgeSources.id, snapshotSourceIds),
                    eq(knowledgeSources.workspaceId, agent.workspaceId),
                    eq(knowledgeSources.status, "indexed"),
                    isNull(knowledgeSources.archivedAt),
                  ))
                  .for("share")
              : [];
            const knowledgeError = validateKnowledgeSnapshot({
              knowledgeTitles,
              snapshotSourceIds,
              availableSourceIds: new Set(availableSources.map((row) => row.id)),
            });
            if (knowledgeError) return { kind: "knowledge-unavailable" as const, error: knowledgeError };
          }
          const restoredManifest = {
            ...manifest.data,
            workflowSnapshot: bindWorkflowRootAgent(manifest.data.workflowSnapshot, agent),
          };
          // 人工恢复是明确的上线决策：旧候选版本即使之后验收完成，也不应再覆盖本次恢复。
          await tx
            .update(agentVersions)
            .set({ status: "superseded", updatedAt: new Date() })
            .where(and(
              eq(agentVersions.agentId, agentId),
              eq(agentVersions.workspaceId, agent.workspaceId),
              eq(agentVersions.status, "candidate"),
            ));
          await tx
            .update(agentVersions)
            .set({ status: "retired", updatedAt: new Date() })
            .where(and(
              eq(agentVersions.agentId, agentId),
              eq(agentVersions.workspaceId, agent.workspaceId),
              eq(agentVersions.status, "production"),
            ));
          const [row] = await tx
            .select({ maxVersion: sql<number>`coalesce(max(${agentVersions.version}), 0)`.mapWith(Number) })
            .from(agentVersions)
            .where(and(eq(agentVersions.agentId, agentId), eq(agentVersions.workspaceId, agent.workspaceId)));
          const [created] = await tx.insert(agentVersions).values({
            agentId,
            workspaceId: agent.workspaceId,
            createdBy: DEMO_USER_ID,
            version: (row?.maxVersion ?? 0) + 1,
            status: "production",
            manifest: restoredManifest,
          }).returning({
            id: agentVersions.id,
            version: agentVersions.version,
            status: agentVersions.status,
            createdAt: agentVersions.createdAt,
          });
          await tx.insert(auditEvents).values(auditEventValues({
            workspaceId: agent.workspaceId,
            createdBy: DEMO_USER_ID,
            action: "version.restored",
            targetType: "version",
            targetId: created.id,
            summary: `从版本 ${source.version} 恢复助手「${agent.name}」，生成版本 ${created.version}`,
            data: { version: created.version, sourceVersion: source.version, sourceVersionId: versionId },
          }));
          return {
            kind: "restored" as const,
            version: VersionSummary.parse({ ...created, createdAt: created.createdAt.toISOString() }),
          };
        });
        if (restoreOutcome.kind === "agent-missing") return { ok: false, error: "找不到这个助手，请刷新页面后重试" };
        if (restoreOutcome.kind === "source-missing") return { ok: false, error: "找不到这个历史版本，请刷新页面后重试" };
        if (restoreOutcome.kind === "already-production") return { ok: false, error: "这个版本已经是当前版本" };
        if (restoreOutcome.kind === "source-not-retired") return { ok: false, error: "只有曾经上线的历史版本才能恢复为当前版本" };
        if (restoreOutcome.kind === "manifest-invalid") return { ok: false, error: "历史版本格式过旧，无法直接恢复" };
        if (restoreOutcome.kind === "knowledge-unavailable") return { ok: false, error: restoreOutcome.error };
        revalidatePath(`/agents/${agentId}`);
        return { ok: true, version: restoreOutcome.version };
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
