"use server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { AgentManifest } from "@/contracts/manifest";
import { ScheduleCreateSpec, type ScheduleActionResult } from "@/contracts/schedule";
import { workflowCollaborationKeys } from "@/server/domain/import-agent";
import { inspectCollaborationVersionGraph } from "@/server/domain/runtime/collaboration-dependencies";
import { knowledgeStepTitles, validateKnowledgeSnapshot } from "@/server/domain/runtime/knowledge-snapshot";
import { agents, agentVersions, knowledgeSources, schedules } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { nextOccurrence } from "@/server/domain/schedule-spec";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { revalidatePathsAfterCommit } from "@/server/actions/revalidate-paths";

const Next = z.enum(["paused", "active", "archived"]);

export async function updateScheduleStatusAction(id: string, next: string): Promise<ScheduleActionResult> {
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "定时任务标识不正确，请刷新页面后重试" };
  const parsed = Next.safeParse(next);
  if (!parsed.success) return { ok: false, error: "不支持的状态切换" };
  try {
    const outcome = await db.transaction(async (tx): Promise<ScheduleActionResult> => {
      const [reference] = await tx
        .select({ agentId: schedules.agentId, versionId: schedules.versionId, archivedAt: schedules.archivedAt })
        .from(schedules)
        .where(and(eq(schedules.id, id), eq(schedules.workspaceId, DEMO_WORKSPACE_ID)))
        .limit(1);
      if (!reference) return { ok: false, error: "找不到这条定时任务，请刷新页面后重试" };
      if (reference.archivedAt && parsed.data !== "archived") {
        return { ok: false, error: "找不到这条定时任务，请刷新页面后重试" };
      }
      if (parsed.data === "active") {
        const [version] = await tx
          .select({ manifest: agentVersions.manifest })
          .from(agentVersions)
          .where(and(
            eq(agentVersions.id, reference.versionId),
            eq(agentVersions.agentId, reference.agentId),
            eq(agentVersions.workspaceId, DEMO_WORKSPACE_ID),
            inArray(agentVersions.status, ["production", "retired"]),
          ))
          .limit(1);
        if (!version) return { ok: false, error: "绑定的助手版本不可用或助手已停用，请重新创建定时任务" };
        const manifest = AgentManifest.safeParse(version.manifest);
        if (!manifest.success) return { ok: false, error: "绑定的助手版本信息不完整，请重新发布后再创建定时任务" };
        const collaborationKeys = workflowCollaborationKeys(manifest.data.workflowSnapshot);
        const dependencyVersions = collaborationKeys.length > 0
          ? await tx
              .select({
                versionId: agentVersions.id,
                agentId: agentVersions.agentId,
                agentName: agents.name,
                status: agentVersions.status,
                agentArchivedAt: agents.archivedAt,
                manifest: agentVersions.manifest,
              })
              .from(agentVersions)
              .innerJoin(agents, eq(agents.id, agentVersions.agentId))
              .where(and(eq(agentVersions.workspaceId, DEMO_WORKSPACE_ID), eq(agents.workspaceId, DEMO_WORKSPACE_ID)))
          : [];
        const graph = inspectCollaborationVersionGraph({
          rootAgentId: reference.agentId,
          directKeys: collaborationKeys,
          versions: dependencyVersions,
        });
        if (graph.issue) return { ok: false, error: `${graph.issue}，请检查协作助手后再启用定时任务` };
        // 发布也按助手 ID 锁定整条协作链；恢复定时任务必须在锁内确认没有助手被停用。
        const requiredAgentIds = [...new Set([reference.agentId, ...graph.agentIds])].sort();
        const lockedAgents = await tx
          .select({ id: agents.id, archivedAt: agents.archivedAt })
          .from(agents)
          .where(and(inArray(agents.id, requiredAgentIds), eq(agents.workspaceId, DEMO_WORKSPACE_ID)))
          .orderBy(agents.id)
          .for("share");
        const root = lockedAgents.find((row) => row.id === reference.agentId);
        if (!root || root.archivedAt) {
          return { ok: false, error: "绑定的助手已停用，请恢复助手后再启用定时任务" };
        }
        if (lockedAgents.length !== requiredAgentIds.length || lockedAgents.some((row) => row.archivedAt)) {
          return { ok: false, error: "协作助手已停用，请恢复协作助手后再启用定时任务" };
        }
        // 资料归档先锁来源行；这里在助手锁后持有同一来源共享锁直到任务恢复提交。
        const requiredSourceIds = [...new Set([
          ...manifest.data.knowledgeSnapshot,
          ...graph.knowledgeSourceIds,
        ])].sort();
        const availableSources = requiredSourceIds.length > 0
          ? await tx
              .select({ id: knowledgeSources.id })
              .from(knowledgeSources)
              .where(and(
                inArray(knowledgeSources.id, requiredSourceIds),
                eq(knowledgeSources.workspaceId, DEMO_WORKSPACE_ID),
                eq(knowledgeSources.status, "indexed"),
                isNull(knowledgeSources.archivedAt),
              ))
              .orderBy(knowledgeSources.id)
              .for("share")
          : [];
        const availableSourceIds = new Set(availableSources.map((source) => source.id));
        const knowledgeError = validateKnowledgeSnapshot({
          knowledgeTitles: knowledgeStepTitles(manifest.data.workflowSnapshot.nodes),
          snapshotSourceIds: manifest.data.knowledgeSnapshot,
          availableSourceIds,
        });
        if (knowledgeError) return { ok: false, error: knowledgeError };
        if (requiredSourceIds.some((sourceId) => !availableSourceIds.has(sourceId))) {
          return { ok: false, error: "绑定版本或协作助手使用的知识资料已归档或尚未完成解析，请先恢复资料后再启用定时任务" };
        }
      } else {
        // 暂停与停用助手保持同一锁顺序，不能在读取任务后反向锁助手。
        await tx
          .select({ id: agents.id })
          .from(agents)
          .where(and(eq(agents.id, reference.agentId), eq(agents.workspaceId, DEMO_WORKSPACE_ID)))
          .for("share")
          .limit(1);
      }
      const [schedule] = await tx
        .select()
        .from(schedules)
        .where(and(eq(schedules.id, id), eq(schedules.workspaceId, DEMO_WORKSPACE_ID)))
        .for("update")
        .limit(1);
      if (!schedule || schedule.agentId !== reference.agentId || schedule.versionId !== reference.versionId
        || (schedule.archivedAt && parsed.data !== "archived")) {
        return { ok: false, error: "找不到这条定时任务，请刷新页面后重试" };
      }
      if (schedule.status === parsed.data) return { ok: true };
      let resumedAt: Date | undefined;
      if (parsed.data === "active") {
        const spec = ScheduleCreateSpec.safeParse(schedule.spec);
        if (!spec.success) return { ok: false, error: "定时设置已损坏，请重新创建定时任务" };
        resumedAt = nextOccurrence(spec.data, new Date()) ?? undefined;
        if (!resumedAt) return { ok: false, error: "一次性任务的执行时间已经过去，请重新创建定时任务" };
      }
      const updated = await tx
        .update(schedules)
        .set({
          status: parsed.data,
          archivedAt: parsed.data === "archived" ? new Date() : null,
          nextRunAt: resumedAt,
          leaseUntil: null,
          consecutiveFailures: parsed.data === "active" ? 0 : undefined,
          lastError: parsed.data === "active" ? null : undefined,
          updatedAt: new Date(),
        })
        .where(and(
          eq(schedules.id, id),
          eq(schedules.workspaceId, DEMO_WORKSPACE_ID),
          eq(schedules.status, schedule.status),
          isNull(schedules.archivedAt),
        ))
        .returning({ id: schedules.id });
      return updated.length > 0
        ? { ok: true }
        : { ok: false, error: "定时任务状态已经变化，请刷新页面后重试" };
    });
    if (outcome.ok) revalidatePathsAfterCommit(["/schedules"], "schedule-status");
    return outcome;
  } catch (error) {
    console.error("更新定时任务状态失败", safeErrorForLog(error));
    return { ok: false, error: "更新定时任务状态失败，请稍后重试" };
  }
}
