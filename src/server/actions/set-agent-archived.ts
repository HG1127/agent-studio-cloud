"use server";

import { and, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { AgentArchiveInput, type AgentArchiveResult } from "@/contracts/agent";
import { agents, agentVersions, auditEvents, evaluationRuns, runs, schedules } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { auditEventValues } from "@/server/audit/event-values";
import { activeVersionDependingOnAgent, liveRunDependingOnAgent } from "@/server/domain/runtime/collaboration-dependencies";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";

export async function setAgentArchivedAction(input: unknown): Promise<AgentArchiveResult> {
  const parsed = AgentArchiveInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "助手信息不正确，请刷新页面后重试" };

  try {
    const now = new Date();
    const updated = await db.transaction(async (tx) => {
      const [agent] = await tx
        .select({ id: agents.id, name: agents.name, archivedAt: agents.archivedAt })
        .from(agents)
        .where(and(
          eq(agents.id, parsed.data.agentId),
          eq(agents.workspaceId, DEMO_WORKSPACE_ID),
        ))
        .for("update")
        .limit(1);
      if (!agent) return false;
      if (parsed.data.archived === (agent.archivedAt !== null)) return true;

      if (parsed.data.archived) {
        const [runningEvaluation] = await tx
          .select({ id: evaluationRuns.id })
          .from(evaluationRuns)
          .where(and(
            eq(evaluationRuns.agentId, parsed.data.agentId),
            eq(evaluationRuns.workspaceId, DEMO_WORKSPACE_ID),
            eq(evaluationRuns.status, "running"),
          ))
          .limit(1);
        if (runningEvaluation) return { kind: "evaluation-running" as const };
        const dependencyVersions = await tx
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
          .where(and(
            eq(agentVersions.workspaceId, DEMO_WORKSPACE_ID),
            eq(agents.workspaceId, DEMO_WORKSPACE_ID),
            ne(agentVersions.agentId, parsed.data.agentId),
          ));
        const dependent = activeVersionDependingOnAgent(dependencyVersions, parsed.data.agentId);
        if (dependent) return { kind: "in-use" as const, inUseBy: dependent.agentName };
        const liveRuns = await tx
          .select({ versionId: runs.versionId })
          .from(runs)
          .where(and(
            eq(runs.workspaceId, DEMO_WORKSPACE_ID),
            ne(runs.agentId, parsed.data.agentId),
            inArray(runs.status, ["queued", "running", "waiting_approval", "waiting_event"]),
          ));
        const liveDependent = liveRunDependingOnAgent(
          dependencyVersions,
          new Set(liveRuns.map((run) => run.versionId)),
          parsed.data.agentId,
        );
        if (liveDependent) return { kind: "run-in-use" as const, inUseBy: liveDependent.agentName };
      }

      const rows = await tx
        .update(agents)
        .set({ archivedAt: parsed.data.archived ? now : null, updatedAt: now })
        .where(and(
          eq(agents.id, parsed.data.agentId),
          eq(agents.workspaceId, DEMO_WORKSPACE_ID),
          parsed.data.archived ? isNull(agents.archivedAt) : isNotNull(agents.archivedAt),
        ))
        .returning({ id: agents.id, name: agents.name });
      if (rows.length === 0) return false;

      if (parsed.data.archived) {
        await tx
          .update(schedules)
          .set({ status: "paused", leaseUntil: null, updatedAt: now })
          .where(and(
            eq(schedules.agentId, parsed.data.agentId),
            eq(schedules.workspaceId, DEMO_WORKSPACE_ID),
            isNull(schedules.archivedAt),
            ne(schedules.status, "paused"),
          ));
      }
      await tx.insert(auditEvents).values(auditEventValues({
        workspaceId: DEMO_WORKSPACE_ID,
          createdBy: DEMO_USER_ID,
          action: parsed.data.archived ? "agent.archived" : "agent.restored",
          targetType: "agent",
          targetId: agent.id,
          summary: `${parsed.data.archived ? "停用" : "恢复"}助手「${agent.name}」`,
          data: {},
        }));
      return true;
    });
    if (typeof updated === "object" && updated.kind === "evaluation-running") {
      return { ok: false, error: "自动验收运行期间不能停用助手，请等待验收完成" };
    }
    if (typeof updated === "object" && updated.kind === "run-in-use") {
      return { ok: false, error: `助手「${updated.inUseBy}」仍有运行中的任务需要这个协作助手，请等待运行结束后再停用` };
    }
    if (typeof updated === "object") {
      return { ok: false, error: `助手「${updated.inUseBy}」的当前版本或待验收版本仍在使用它，请先调整并重新发布` };
    }
    if (!updated) return { ok: false, error: "助手状态已经变化，请刷新页面后重试" };
    revalidatePath("/agents");
    revalidatePath(`/agents/${parsed.data.agentId}`);
    revalidatePath("/schedules");
    return { ok: true };
  } catch (error) {
    console.error("更新助手状态失败", safeErrorForLog(error));
    return { ok: false, error: "更新助手状态失败，请稍后重试" };
  }
}
