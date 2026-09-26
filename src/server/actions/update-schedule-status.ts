"use server";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ScheduleSpec, type ScheduleActionResult } from "@/contracts/schedule";
import { agentVersions, schedules } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { nextOccurrence } from "@/server/domain/schedule-spec";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";

const Next = z.enum(["paused", "active", "archived"]);

export async function updateScheduleStatusAction(id: string, next: string): Promise<ScheduleActionResult> {
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "定时任务标识不正确，请刷新页面后重试" };
  const parsed = Next.safeParse(next);
  if (!parsed.success) return { ok: false, error: "不支持的状态切换" };
  try {
    const [schedule] = await db
      .select()
      .from(schedules)
      .where(and(eq(schedules.id, id), eq(schedules.workspaceId, DEMO_WORKSPACE_ID), isNull(schedules.archivedAt)))
      .limit(1);
    if (!schedule) return { ok: false, error: "找不到这条定时任务，请刷新页面后重试" };
    let resumedAt: Date | undefined;
    if (parsed.data === "active") {
      const [version] = await db
        .select({ status: agentVersions.status })
        .from(agentVersions)
        .where(and(
          eq(agentVersions.id, schedule.versionId),
          eq(agentVersions.workspaceId, DEMO_WORKSPACE_ID),
        ))
        .limit(1);
      if (!version || version.status !== "production") {
        return { ok: false, error: "绑定的助手版本已不是生产版本，请重新创建定时任务" };
      }
      const spec = ScheduleSpec.safeParse(schedule.spec);
      if (!spec.success) return { ok: false, error: "定时设置已损坏，请重新创建定时任务" };
      resumedAt = nextOccurrence(spec.data, new Date()) ?? undefined;
      if (!resumedAt) return { ok: false, error: "一次性任务的执行时间已经过去，请重新创建定时任务" };
    }
    const updated = await db
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
      .where(and(eq(schedules.id, id), eq(schedules.workspaceId, DEMO_WORKSPACE_ID), isNull(schedules.archivedAt)))
      .returning({ id: schedules.id });
    if (updated.length === 0) return { ok: false, error: "定时任务状态已经变化，请刷新页面后重试" };
    revalidatePath("/schedules");
    return { ok: true };
  } catch (error) {
    console.error("更新定时任务状态失败", safeErrorForLog(error));
    return { ok: false, error: "更新定时任务状态失败，请稍后重试" };
  }
}
