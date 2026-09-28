"use server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { AgentManifest } from "@/contracts/manifest";
import { ScheduleCreateSpec, type ScheduleActionResult } from "@/contracts/schedule";
import { agents, agentVersions, schedules } from "@/db/schema";
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
        .select({ agentId: schedules.agentId })
        .from(schedules)
        .where(and(eq(schedules.id, id), eq(schedules.workspaceId, DEMO_WORKSPACE_ID)))
        .limit(1);
      if (!reference) return { ok: false, error: "找不到这条定时任务，请刷新页面后重试" };
      // 停用助手先锁助手再暂停其定时任务；这里保持同一锁顺序，防止并发恢复反向覆盖。
      const [agent] = await tx
        .select({ archivedAt: agents.archivedAt })
        .from(agents)
        .where(and(eq(agents.id, reference.agentId), eq(agents.workspaceId, DEMO_WORKSPACE_ID)))
        .for("share")
        .limit(1);
      const [schedule] = await tx
        .select()
        .from(schedules)
        .where(and(eq(schedules.id, id), eq(schedules.workspaceId, DEMO_WORKSPACE_ID)))
        .for("update")
        .limit(1);
      if (!schedule || (schedule.archivedAt && parsed.data !== "archived")) {
        return { ok: false, error: "找不到这条定时任务，请刷新页面后重试" };
      }
      if (schedule.status === parsed.data) {
        if (parsed.data === "active" && (!agent || agent.archivedAt)) {
          return { ok: false, error: "绑定的助手已停用，请恢复助手后再启用定时任务" };
        }
        return { ok: true };
      }
      let resumedAt: Date | undefined;
      if (parsed.data === "active") {
        if (!agent || agent.archivedAt) {
          return { ok: false, error: "绑定的助手已停用，请恢复助手后再启用定时任务" };
        }
        const [version] = await tx
          .select({ manifest: agentVersions.manifest })
          .from(agentVersions)
          .where(and(
            eq(agentVersions.id, schedule.versionId),
            eq(agentVersions.agentId, schedule.agentId),
            eq(agentVersions.workspaceId, DEMO_WORKSPACE_ID),
            inArray(agentVersions.status, ["production", "retired"]),
          ))
          .limit(1);
        if (!version) return { ok: false, error: "绑定的助手版本不可用或助手已停用，请重新创建定时任务" };
        if (!AgentManifest.safeParse(version.manifest).success) return { ok: false, error: "绑定的助手版本信息不完整，请重新发布后再创建定时任务" };
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
