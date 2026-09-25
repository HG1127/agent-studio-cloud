"use server";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
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
      .select({ draft: workflowDefinitions.draft })
      .from(workflowDefinitions)
      .where(eq(workflowDefinitions.agentId, agentId))
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
    const snapshotRows = await db
      .select({ id: knowledgeSources.id })
      .from(knowledgeSources)
      .where(and(eq(knowledgeSources.workspaceId, agent.workspaceId), eq(knowledgeSources.status, "indexed"), isNull(knowledgeSources.archivedAt)));
    const manifest = buildManifest(draft, {
      modelId: manifestModel.modelId,
      mock: manifestModel.mock,
      connectionId: manifestModel.connectionId,
      knowledgeSnapshot: snapshotRows.map((row) => row.id),
    });
    const [evaluationCaseSummary] = await db
      .select({ count: sql<number>`count(*)`.mapWith(Number) })
      .from(evaluationCases)
      .where(and(
        eq(evaluationCases.agentId, agentId),
        eq(evaluationCases.workspaceId, agent.workspaceId),
        isNull(evaluationCases.archivedAt),
      ));
    const release = releaseStatusForCaseCount(evaluationCaseSummary?.count ?? 0);
    // 并发发布会撞 (agent_id, version) 唯一索引：整个事务重读 maxVersion 后重试一次
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const publishedVersion = await db.transaction(async (tx) => {
          const now = new Date();
          await tx
            .update(agentVersions)
            .set({ status: "superseded", updatedAt: now })
            .where(and(eq(agentVersions.agentId, agentId), eq(agentVersions.status, "candidate")));
          if (release === "production") {
            await tx
              .update(agentVersions)
              .set({ status: "retired", updatedAt: now })
              .where(and(eq(agentVersions.agentId, agentId), eq(agentVersions.status, "production")));
          }
          const [row] = await tx
            .select({ maxVersion: sql<number>`coalesce(max(${agentVersions.version}), 0)`.mapWith(Number) })
            .from(agentVersions)
            .where(eq(agentVersions.agentId, agentId));
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
          return VersionSummary.parse({ ...created, createdAt: created.createdAt.toISOString() });
        });
        revalidatePath(`/agents/${agentId}`);
        return { ok: true, release, version: publishedVersion, exempted: exempted.map((issue) => ({ title: issue.title })) };
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
