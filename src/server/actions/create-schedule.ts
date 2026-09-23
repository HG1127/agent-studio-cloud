"use server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { AgentManifest } from "@/contracts/manifest";
import { ScheduleCreateInput } from "@/contracts/schedule";
import { agentVersions, agents, schedules } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { nextOccurrence } from "@/server/domain/schedule-spec";

export async function createScheduleAction(raw: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = ScheduleCreateInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "定时设置不完整，请检查频率与时间后重试" };
  }
  const { agentId, spec, input } = parsed.data;
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), isNull(agents.archivedAt), eq(agents.workspaceId, DEMO_WORKSPACE_ID)))
    .limit(1);
  if (!agent) return { ok: false, error: "找不到这个助手，请刷新页面后重试" };
  const [version] = await db
    .select({ id: agentVersions.id, manifest: agentVersions.manifest })
    .from(agentVersions)
    .where(and(eq(agentVersions.agentId, agentId), eq(agentVersions.status, "production")))
    .orderBy(desc(agentVersions.version))
    .limit(1);
  if (!version) return { ok: false, error: "这个助手还没有发布版本，请先发布后再设置定时" };
  // 运行输入按版本输入契约校验（M1 契约为「业务输入」单字段，全部 required）
  const manifest = AgentManifest.safeParse(version.manifest);
  if (manifest.success) {
    for (const field of manifest.data.inputContract.fields) {
      if (field.required && !(field.name in input)) {
        return { ok: false, error: `运行输入缺少必填项：${field.label}` };
      }
    }
  }
  const next = nextOccurrence(spec, new Date());
  if (!next) return { ok: false, error: "一次性任务的执行时间必须在未来" };
  await db.insert(schedules).values({
    workspaceId: agent.workspaceId, agentId, versionId: version.id,
    status: "active", spec, input, nextRunAt: next, createdBy: DEMO_USER_ID,
  });
  revalidatePath("/schedules");
  return { ok: true };
}
