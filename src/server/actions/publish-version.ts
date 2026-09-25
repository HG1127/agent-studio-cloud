"use server";

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { VersionSummary, type PublishVersionResult } from "@/contracts/version";
import { PublishModelSelection } from "@/contracts/connections";
import { WorkflowDraft } from "@/contracts/workflow";
import { agentVersions, agents, auditEvents, evaluationCases, knowledgeSources, modelConnections, workflowDefinitions } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { realModelsEnabled, resolvePublishModel } from "@/lib/model";
import { db } from "@/lib/db";
import { auditWorkflow } from "@/server/domain/audit";
import { buildManifest, filterPublishBlockers } from "@/server/domain/pipeline";
import { releaseStatusForCaseCount } from "@/server/domain/release-gate";
import { isUniqueViolation } from "@/server/unique-violation";
import { validateOutputContract } from "@/server/domain/runtime/output-contract";
import { validateWaitContracts } from "@/server/domain/runtime/wait-contract";
import { validateWorkflowRoutes } from "@/server/domain/runtime/workflow-routes";
import { auditEventValues } from "@/server/audit/event-values";
import { bindWorkflowRootAgent } from "@/server/domain/workflow-root-agent";
import { knowledgeStepTitles, prepareKnowledgeSnapshot } from "@/server/domain/runtime/knowledge-snapshot";
import { workflowCollaborationKeys } from "@/server/domain/import-agent";
import { inspectCollaborationVersionGraph } from "@/server/domain/runtime/collaboration-dependencies";

export async function publishVersionAction(agentId: string, modelSelection?: PublishModelSelection): Promise<PublishVersionResult> {
  if (!z.string().uuid().safeParse(agentId).success) {
    return { ok: false, error: "助手标识不正确，请刷新页面后重试", issues: [] };
  }
  try {
    const [agent] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), isNull(agents.archivedAt), eq(agents.workspaceId, DEMO_WORKSPACE_ID)))
      .limit(1);
    if (!agent) {
      return { ok: false, error: "找不到这个助手，请刷新页面后重试", issues: [] };
    }
    const [definition] = await db
      .select({ id: workflowDefinitions.id, draft: workflowDefinitions.draft, updatedAt: workflowDefinitions.updatedAt })
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.agentId, agentId), eq(workflowDefinitions.workspaceId, agent.workspaceId)))
      .orderBy(desc(workflowDefinitions.createdAt))
      .limit(1);
    if (!definition) {
      return { ok: false, error: "这个助手还没有流程草稿，请先在画布上保存草稿再发布", issues: [] };
    }
    // 组装指纹/manifest 前先过契约（与创建助手入库前 parse 同一裁定），坏数据拦在门外
    const parsed = WorkflowDraft.safeParse(definition.draft);
    if (!parsed.success) {
      return { ok: false, error: "流程草稿没有通过校验，请在画布上重新保存后再发布", issues: [] };
    }
    const draft = bindWorkflowRootAgent(parsed.data, agent);
    const outputPathError = validateOutputContract(draft.outputContract?.fields ?? [], draft.nodes);
    if (outputPathError) {
      return { ok: false, error: outputPathError, issues: [] };
    }
    const waitError = validateWaitContracts(draft.nodes);
    if (waitError) return { ok: false, error: waitError, issues: [] };
    const routeError = validateWorkflowRoutes(draft);
    if (routeError) return { ok: false, error: routeError, issues: [] };
    const audit = auditWorkflow(draft);
    // M1 演示发布策略：critical 门禁交给 filterPublishBlockers 裁决，豁免项随成功返回值透出给面板提醒
    const { blocking, exempted } = filterPublishBlockers(audit.issues, draft);
    if (blocking.length > 0) {
      return {
        ok: false,
        error: `设计检查未通过：还有 ${blocking.length} 个阻塞问题，解决后才能发布`,
        issues: blocking.map((issue) => `${issue.title}：${issue.detail}`),
      };
    }
    // 发布时冻结运行模型：显式选择了连接就校验后用连接；未选择时维持环境变量守卫
    let manifestModel: { modelId: string; mock: boolean; connectionId: string | null };
    if (modelSelection) {
      if (!realModelsEnabled()) return { ok: false, error: "真实模型功能尚未开放", issues: [] };
      const selection = PublishModelSelection.safeParse(modelSelection);
      if (!selection.success) {
        return { ok: false, error: "所选运行模型无效，请重新选择后再发布", issues: [] };
      }
      const [connection] = await db
        .select({ id: modelConnections.id, modelIds: modelConnections.modelIds })
        .from(modelConnections)
        .where(
          and(
            eq(modelConnections.id, selection.data.connectionId),
            eq(modelConnections.workspaceId, agent.workspaceId),
            isNull(modelConnections.archivedAt),
          ),
        )
        .limit(1);
      if (!connection) {
        return { ok: false, error: "所选模型连接不存在或已删除，请重新选择后再发布", issues: [] };
      }
      if (!connection.modelIds.includes(selection.data.modelId)) {
        return { ok: false, error: "所选模型已不在该连接的模型列表里，请重新选择后再发布", issues: [] };
      }
      manifestModel = { modelId: selection.data.modelId, mock: false, connectionId: connection.id };
    } else {
      // T10 携带裁定：模型配置守卫——无 MODEL_ID 且未显式 MODEL_MOCK=1 时不写入永久版本记录
      const resolved = resolvePublishModel({ modelId: process.env.MODEL_ID, modelMock: process.env.MODEL_MOCK });
      if (!resolved.ok) {
        return { ok: false, error: resolved.error, issues: [] };
      }
      manifestModel = { modelId: resolved.modelId, mock: resolved.mock, connectionId: null };
    }
    if (!manifestModel.mock && !realModelsEnabled()) {
      return { ok: false, error: "真实模型功能尚未开放", issues: [] };
    }
    const snapshotRows = knowledgeStepTitles(draft.nodes).length > 0
      ? await db
          .select({ id: knowledgeSources.id })
          .from(knowledgeSources)
          .where(and(eq(knowledgeSources.workspaceId, agent.workspaceId), eq(knowledgeSources.status, "indexed"), isNull(knowledgeSources.archivedAt)))
      : [];
    const knowledgeSnapshot = prepareKnowledgeSnapshot(draft.nodes, snapshotRows.map((row) => row.id));
    if (!knowledgeSnapshot.ok) return { ok: false, error: knowledgeSnapshot.error, issues: [] };
    const collaborationKeys = workflowCollaborationKeys(draft);
    const uuid = z.string().uuid();
    const collaborationRefs = collaborationKeys.map((key) => {
      const separator = key.lastIndexOf(":");
      return { agentId: key.slice(0, separator), versionId: key.slice(separator + 1) };
    });
    if (collaborationRefs.some((ref) => !uuid.safeParse(ref.agentId).success || !uuid.safeParse(ref.versionId).success)) {
      return { ok: false, error: "协作助手信息不完整，请重新选择后再发布", issues: [] };
    }
    const manifest = buildManifest(draft, {
      modelId: manifestModel.modelId,
      mock: manifestModel.mock,
      connectionId: manifestModel.connectionId,
      knowledgeSnapshot: knowledgeSnapshot.sourceIds,
    });
    // 并发发布会撞 (agent_id, version) 唯一索引：整个事务重读 maxVersion 后重试一次
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const publishOutcome = await db.transaction(async (tx) => {
          // 保存流程和修改基本信息都会先锁同一助手行；发布也拿这把锁并核对快照，
          // 同时锁住协作目标，防止发布与停用并发时留下上线即失效的版本。
          const dependencyVersions = collaborationRefs.length > 0
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
                .where(and(
                  eq(agentVersions.workspaceId, agent.workspaceId),
                  eq(agents.workspaceId, agent.workspaceId),
                ))
            : [];
          const collaborationGraph = inspectCollaborationVersionGraph({
            rootAgentId: agentId,
            directKeys: collaborationKeys,
            versions: dependencyVersions,
          });
          if (collaborationGraph.issue) {
            return { kind: "collaboration_invalid" as const, error: collaborationGraph.issue };
          }
          const requiredKnowledgeSourceIds = [...new Set([
            ...knowledgeSnapshot.sourceIds,
            ...collaborationGraph.knowledgeSourceIds,
          ])];
          const collaborationAgentIds = collaborationGraph.agentIds;
          const lockedAgents = await tx
            .select({ id: agents.id, updatedAt: agents.updatedAt, archivedAt: agents.archivedAt })
            .from(agents)
            .where(and(
              inArray(agents.id, [...new Set([agentId, ...collaborationAgentIds])].sort()),
              eq(agents.workspaceId, agent.workspaceId),
            ))
            .orderBy(agents.id)
            .for("update");
          const lockedAgent = lockedAgents.find((row) => row.id === agentId);
          if (!lockedAgent || lockedAgent.archivedAt || lockedAgent.updatedAt.getTime() !== agent.updatedAt.getTime()) {
            return { kind: "stale" as const };
          }
          const availableAgentIds = new Set(lockedAgents.filter((row) => !row.archivedAt).map((row) => row.id));
          if (collaborationAgentIds.some((id) => !availableAgentIds.has(id))) {
            return { kind: "collaboration_changed" as const };
          }
          const [lockedDefinition] = await tx
            .select({ updatedAt: workflowDefinitions.updatedAt })
            .from(workflowDefinitions)
            .where(and(eq(workflowDefinitions.id, definition.id), eq(workflowDefinitions.workspaceId, agent.workspaceId)))
            .for("update")
            .limit(1);
          if (!lockedDefinition || lockedDefinition.updatedAt.getTime() !== definition.updatedAt.getTime()) {
            return { kind: "stale" as const };
          }
          const [evaluationCaseSummary] = await tx
            .select({ count: sql<number>`count(*)`.mapWith(Number) })
            .from(evaluationCases)
            .where(and(
              eq(evaluationCases.agentId, agentId),
              eq(evaluationCases.workspaceId, agent.workspaceId),
              isNull(evaluationCases.archivedAt),
            ));
          const release = releaseStatusForCaseCount(evaluationCaseSummary?.count ?? 0);
          if (requiredKnowledgeSourceIds.length > 0) {
            const lockedSources = await tx
              .select({ id: knowledgeSources.id })
              .from(knowledgeSources)
              .where(and(
                inArray(knowledgeSources.id, requiredKnowledgeSourceIds),
                eq(knowledgeSources.workspaceId, agent.workspaceId),
                eq(knowledgeSources.status, "indexed"),
                isNull(knowledgeSources.archivedAt),
              ))
              .for("share");
            if (lockedSources.length !== requiredKnowledgeSourceIds.length) {
              return { kind: "knowledge_changed" as const };
            }
          }
          const now = new Date();
          await tx
            .update(agentVersions)
            .set({ status: "superseded", updatedAt: now })
            .where(and(
              eq(agentVersions.agentId, agentId),
              eq(agentVersions.workspaceId, agent.workspaceId),
              eq(agentVersions.status, "candidate"),
            ));
          if (release === "production") {
            await tx
              .update(agentVersions)
              .set({ status: "retired", updatedAt: now })
              .where(and(
                eq(agentVersions.agentId, agentId),
                eq(agentVersions.workspaceId, agent.workspaceId),
                eq(agentVersions.status, "production"),
              ));
          }
          const [row] = await tx
            .select({ maxVersion: sql<number>`coalesce(max(${agentVersions.version}), 0)`.mapWith(Number) })
            .from(agentVersions)
            .where(and(eq(agentVersions.agentId, agentId), eq(agentVersions.workspaceId, agent.workspaceId)));
          const [created] = await tx.insert(agentVersions).values({
            agentId,
            workspaceId: agent.workspaceId,
            createdBy: DEMO_USER_ID,
            version: (row?.maxVersion ?? 0) + 1,
            status: release,
            manifest,
          }).returning({
            id: agentVersions.id,
            version: agentVersions.version,
            status: agentVersions.status,
            createdAt: agentVersions.createdAt,
          });
          await tx.insert(auditEvents).values(auditEventValues({
            workspaceId: agent.workspaceId,
            createdBy: DEMO_USER_ID,
            action: "version.published",
            targetType: "version",
            targetId: created.id,
            summary: `发布助手「${agent.name}」的版本 ${created.version}`,
            data: { version: created.version, release },
          }));
          return {
            kind: "published" as const,
            release,
            version: VersionSummary.parse({ ...created, createdAt: created.createdAt.toISOString() }),
          };
        });
        if (publishOutcome.kind === "stale") {
          return { ok: false, error: "助手或流程刚刚发生变化，请重新发布", issues: [] };
        }
        if (publishOutcome.kind === "knowledge_changed") {
          return { ok: false, error: "流程依赖的知识资料刚刚发生变化，请恢复资料或重新发布", issues: [] };
        }
        if (publishOutcome.kind === "collaboration_changed") {
          return { ok: false, error: "协作助手刚刚被停用或版本已不可用，请重新选择后发布", issues: [] };
        }
        if (publishOutcome.kind === "collaboration_invalid") {
          return { ok: false, error: `${publishOutcome.error}，请调整协作步骤后再发布`, issues: [] };
        }
        revalidatePath(`/agents/${agentId}`);
        return { ok: true, release: publishOutcome.release, version: publishOutcome.version, exempted: exempted.map((issue) => ({ title: issue.title })) };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        if (attempt > 0) {
          return { ok: false, error: "发布冲突，请重试", issues: [] };
        }
      }
    }
    return { ok: false, error: "发布冲突，请重试", issues: [] };
  } catch (error) {
    console.error("发布失败：", error);
    return { ok: false, error: "发布失败，请稍后重试", issues: [] };
  }
}
