"use server";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { PublishVersionResult } from "@/contracts/version";
import { WorkflowDraft } from "@/contracts/workflow";
import { agentVersions, agents, workflowDefinitions } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { resolvePublishModel } from "@/lib/model";
import { db } from "@/lib/db";
import { auditWorkflow } from "@/server/domain/audit";
import { buildManifest, filterPublishBlockers } from "@/server/domain/pipeline";
import { isUniqueViolation } from "@/server/unique-violation";

export async function publishVersionAction(agentId: string): Promise<PublishVersionResult> {
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
    const audit = auditWorkflow(parsed.data);
    // M1 演示发布策略：critical 门禁交给 filterPublishBlockers 裁决，豁免项随成功返回值透出给面板提醒
    const { blocking, exempted } = filterPublishBlockers(audit.issues, parsed.data);
    if (blocking.length > 0) {
      return {
        ok: false,
        error: `设计检查未通过：还有 ${blocking.length} 个阻塞问题，解决后才能发布`,
        issues: blocking.map((issue) => `${issue.title}：${issue.detail}`),
      };
    }
    // T10 携带裁定：模型配置守卫——无 MODEL_ID 且未显式 MODEL_MOCK=1 时不写入永久版本记录
    const resolved = resolvePublishModel({ modelId: process.env.MODEL_ID, modelMock: process.env.MODEL_MOCK });
    if (!resolved.ok) {
      return { ok: false, error: resolved.error, issues: [] };
    }
    const manifest = buildManifest(parsed.data, { modelId: resolved.modelId, mock: resolved.mock });
    // 并发发布会撞 (agent_id, version) 唯一索引：整个事务重读 maxVersion 后重试一次
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await db.transaction(async (tx) => {
          await tx
            .update(agentVersions)
            .set({ status: "retired", updatedAt: new Date() })
            .where(and(eq(agentVersions.agentId, agentId), eq(agentVersions.status, "production")));
          const [row] = await tx
            .select({ maxVersion: sql<number>`coalesce(max(${agentVersions.version}), 0)`.mapWith(Number) })
            .from(agentVersions)
            .where(eq(agentVersions.agentId, agentId));
          await tx.insert(agentVersions).values({
            agentId,
            workspaceId: agent.workspaceId,
            createdBy: DEMO_USER_ID,
            version: (row?.maxVersion ?? 0) + 1,
            status: "production",
            manifest,
          });
        });
        revalidatePath(`/agents/${agentId}`);
        return { ok: true, exempted: exempted.map((issue) => ({ title: issue.title })) };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        if (attempt > 0) {
          return { ok: false, error: "发布冲突，请重试", issues: [] };
        }
      }
    }
    return { ok: false, error: "发布冲突，请重试", issues: [] };
  } catch {
    return { ok: false, error: "发布失败，请稍后重试", issues: [] };
  }
}
