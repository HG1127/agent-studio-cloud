"use server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { AgentManifest } from "@/contracts/manifest";
import { ScheduleCreateInput, type ScheduleActionResult } from "@/contracts/schedule";
import { agentVersions, agents, knowledgeSources, schedules } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { validateRunInput } from "@/server/domain/runtime/run-input";
import { nextOccurrence } from "@/server/domain/schedule-spec";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";
import { validationMessage } from "@/server/domain/validation-message";
import { revalidatePathsAfterCommit } from "@/server/actions/revalidate-paths";
import { jsonValuesEqual } from "@/server/domain/json-value";
import { workflowCollaborationKeys } from "@/server/domain/import-agent";
import { inspectCollaborationVersionGraph } from "@/server/domain/runtime/collaboration-dependencies";
import { knowledgeStepTitles, validateKnowledgeSnapshot } from "@/server/domain/runtime/knowledge-snapshot";

async function existingRequestResult(requestId: string, agentId: string, spec: unknown, input: unknown): Promise<ScheduleActionResult | null> {
  const [existing] = await db
    .select({ agentId: schedules.agentId, spec: schedules.spec, input: schedules.input })
    .from(schedules)
    .where(and(eq(schedules.workspaceId, DEMO_WORKSPACE_ID), eq(schedules.requestId, requestId)))
    .limit(1);
  if (!existing) return null;
  return existing.agentId === agentId && jsonValuesEqual(existing.spec, spec) && jsonValuesEqual(existing.input, input)
    ? { ok: true }
    : { ok: false, error: "这项请求标识已经用于另一条定时任务，请重新发起" };
}

export async function createScheduleAction(raw: unknown): Promise<ScheduleActionResult> {
  const parsed = ScheduleCreateInput.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: validationMessage(parsed.error, "定时设置不完整，请检查频率与时间后重试") };
  }
  const { agentId, requestId, spec, input } = parsed.data;
  try {
    if (requestId) {
      const existing = await existingRequestResult(requestId, agentId, spec, input);
      if (existing) {
        if (existing.ok) revalidatePathsAfterCommit(["/schedules"], "schedule-create-reuse");
        return existing;
      }
    }
    const result = await db.transaction(async (tx): Promise<ScheduleActionResult | null> => {
      // 先读取冻结版本及协作链，再按 ID 顺序锁住整条助手链，避免不同入口反向加锁。
      const [agent] = await tx
        .select()
        .from(agents)
        .where(and(eq(agents.id, agentId), isNull(agents.archivedAt), eq(agents.workspaceId, DEMO_WORKSPACE_ID)))
        .limit(1);
      if (!agent) return { ok: false, error: "找不到这个助手，请刷新页面后重试" };
      const [version] = await tx
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
        rootAgentId: agentId,
        directKeys: collaborationKeys,
        versions: dependencyVersions,
      });
      if (graph.issue) return { ok: false, error: `${graph.issue}，请检查协作助手后再设置定时` };
      const requiredAgentIds = [...new Set([agentId, ...graph.agentIds])].sort();
      const lockedAgents = await tx
        .select({ id: agents.id, archivedAt: agents.archivedAt })
        .from(agents)
        .where(and(inArray(agents.id, requiredAgentIds), eq(agents.workspaceId, DEMO_WORKSPACE_ID)))
        .orderBy(agents.id)
        .for("share");
      if (lockedAgents.length !== requiredAgentIds.length || lockedAgents.some((row) => row.archivedAt)) {
        return { ok: false, error: "助手或协作助手已停用，请恢复后再设置定时" };
      }
      const requiredSourceIds = [...new Set([...manifest.data.knowledgeSnapshot, ...graph.knowledgeSourceIds])].sort();
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
        return { ok: false, error: "当前版本或协作助手使用的知识资料已归档或尚未完成解析，请先恢复资料后再设置定时" };
      }
      const inputError = validateRunInput(input, manifest.data.inputContract.fields);
      if (inputError) return { ok: false, error: inputError };
      const next = nextOccurrence(spec, new Date());
      if (!next) return { ok: false, error: "一次性任务的执行时间必须在未来" };
      const inserted = await tx.insert(schedules).values({
        workspaceId: agent.workspaceId, agentId, versionId: version.id,
        requestId: requestId ?? null, status: "active", spec, input, nextRunAt: next, createdBy: DEMO_USER_ID,
      }).onConflictDoNothing({ target: [schedules.workspaceId, schedules.requestId] }).returning({ id: schedules.id });
      return inserted.length > 0 ? { ok: true } : null;
    });
    if (!result) {
      const existing = requestId ? await existingRequestResult(requestId, agentId, spec, input) : null;
      if (existing) {
        if (existing.ok) revalidatePathsAfterCommit(["/schedules"], "schedule-create-reuse");
        return existing;
      }
      return { ok: false, error: "定时任务创建冲突，请稍后重试" };
    }
    if (result.ok) revalidatePathsAfterCommit(["/schedules"], "schedule-create");
    return result;
  } catch (error) {
    console.error("创建定时任务失败", safeErrorForLog(error));
    if (requestId) {
      try {
        const existing = await existingRequestResult(requestId, agentId, spec, input);
        if (existing) {
          if (existing.ok) revalidatePathsAfterCommit(["/schedules"], "schedule-create-reuse");
          return existing;
        }
      } catch (lookupError) {
        console.error("核对定时任务创建状态失败", safeErrorForLog(lookupError));
      }
      return { ok: false, error: "定时任务创建状态待确认，请用同一次请求重试", retryable: true };
    }
    return { ok: false, error: "创建定时任务失败，请稍后重试" };
  }
}
