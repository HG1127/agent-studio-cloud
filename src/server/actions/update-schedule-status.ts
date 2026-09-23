"use server";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { agentVersions, schedules } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";

const Next = z.enum(["paused", "active", "archived"]);

export async function updateScheduleStatusAction(id: string, next: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "定时任务标识不正确，请刷新页面后重试" };
  const parsed = Next.safeParse(next);
  if (!parsed.success) return { ok: false, error: "不支持的状态切换" };
  const [schedule] = await db
    .select()
    .from(schedules)
    .where(and(eq(schedules.id, id), eq(schedules.workspaceId, DEMO_WORKSPACE_ID), isNull(schedules.archivedAt)))
    .limit(1);
  if (!schedule) return { ok: false, error: "找不到这条定时任务，请刷新页面后重试" };
  if (parsed.data === "active") {
    const [version] = await db
      .select({ status: agentVersions.status })
      .from(agentVersions)
      .where(eq(agentVersions.id, schedule.versionId))
      .limit(1);
    if (!version || version.status !== "production") {
      return { ok: false, error: "绑定的助手版本已不是生产版本，请重新创建定时任务" };
    }
  }
  await db
    .update(schedules)
    .set({
      status: parsed.data,
      archivedAt: parsed.data === "archived" ? new Date() : null,
      consecutiveFailures: parsed.data === "active" ? 0 : undefined,
      lastError: parsed.data === "active" ? null : undefined,
      updatedAt: new Date(),
    })
    .where(eq(schedules.id, id));
  revalidatePath("/schedules");
  return { ok: true };
}
