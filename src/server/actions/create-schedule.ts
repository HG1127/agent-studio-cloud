"use server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { AgentManifest } from "@/contracts/manifest";
import { ScheduleCreateInput, type ScheduleActionResult } from "@/contracts/schedule";
import { agentVersions, agents, schedules } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { validateRunInput } from "@/server/domain/runtime/run-input";
import { nextOccurrence } from "@/server/domain/schedule-spec";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { validationMessage } from "@/server/domain/validation-message";
import { revalidatePathsAfterCommit } from "@/server/actions/revalidate-paths";

export async function createScheduleAction(raw: unknown): Promise<ScheduleActionResult> {
  const parsed = ScheduleCreateInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: validationMessage(parsed.error, "定时设置不完整，请检查频率与时间后重试") };
  }
  const { agentId, spec, input } = parsed.data;
  try {
    const [agent] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), isNull(agents.archivedAt), eq(agents.workspaceId, DEMO_WORKSPACE_ID)))
      .limit(1);
    if (!agent) return { ok: false, error: "找不到这个助手，请刷新页面后重试" };
    const [version] = await db
      .select({ id: agentVersions.id, manifest: agentVersions.manifest })
      .from(agentVersions)
      .where(and(
        eq(agentVersions.agentId, agentId),
        eq(agentVersions.workspaceId, agent.workspaceId),
        eq(agentVersions.status, "production"),
      ))
      .orderBy(desc(agentVersions.version))
      .limit(1);
    if (!version) return { ok: false, error: "这个助手还没有发布版本，请先发布后再设置定时" };
    const manifest = AgentManifest.safeParse(version.manifest);
    if (!manifest.success) return { ok: false, error: "当前发布版本信息不完整，请重新发布后再设置定时" };
    const inputError = validateRunInput(input, manifest.data.inputContract.fields);
    if (inputError) return { ok: false, error: inputError };
    const next = nextOccurrence(spec, new Date());
    if (!next) return { ok: false, error: "一次性任务的执行时间必须在未来" };
    await db.insert(schedules).values({
      workspaceId: agent.workspaceId, agentId, versionId: version.id,
      status: "active", spec, input, nextRunAt: next, createdBy: DEMO_USER_ID,
    });
    revalidatePathsAfterCommit(["/schedules"], "schedule-create");
    return { ok: true };
  } catch (error) {
    console.error("创建定时任务失败", safeErrorForLog(error));
    return { ok: false, error: "创建定时任务失败，请稍后重试" };
  }
}
