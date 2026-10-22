import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import {
  PublicToolManageResult, PublicToolPublication, PublicToolStoredCall, PublicToolKeyView,
  type PublicToolManageInput, type PublicToolFailure, type PublicToolCallInput, type PublicToolStoredCall as StoredCall,
} from "@/contracts/public-agent-tool";
import { agentVersions, agents, publicAgentTools, publicAgentToolCalls, publicAgentToolChanges, publicAgentToolKeys } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import {
  freezePublicToolPublication, presentPublicTool, publicToolCanonicalJson, publicToolHash, publicToolHasCredentials,
  publicToolInputHash, publicToolInputIssue, publicToolPublicationMatches,
} from "@/server/domain/public-agent-tool";
import { lockExecutionWorkspace } from "@/server/services/execution-resources";

export class PublicToolRejected extends Error {
  constructor(public readonly code: PublicToolFailure["code"], message: string) { super(message); }
}
function keyView(row: { id: string; name: string; expiresAt: Date | null; revokedAt: Date | null; createdAt: Date }) {
  return PublicToolKeyView.parse({ keyId: row.id, name: row.name, expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() });
}
export async function managePublicTool(input: PublicToolManageInput): Promise<PublicToolManageResult> {
  if (publicToolHasCredentials(input)) throw new PublicToolRejected("invalid", "工具设置不能包含凭据");
  const requestHash = publicToolHash(publicToolCanonicalJson(input));
  return db.transaction(async (tx) => {
    await lockExecutionWorkspace(tx, DEMO_WORKSPACE_ID);
    const [previous] = await tx.select({ toolId: publicAgentToolChanges.toolId, requestHash: publicAgentToolChanges.requestHash,
      revision: publicAgentToolChanges.revision, keyId: publicAgentToolChanges.keyId,
    }).from(publicAgentToolChanges).where(and(eq(publicAgentToolChanges.workspaceId, DEMO_WORKSPACE_ID), eq(publicAgentToolChanges.requestId, input.requestId))).limit(1);
    if (previous) {
      if (previous.requestHash !== requestHash) throw new PublicToolRejected("conflict", "同一次管理请求不能更换内容");
      const [tool] = await tx.select().from(publicAgentTools).where(and(eq(publicAgentTools.id, previous.toolId), eq(publicAgentTools.workspaceId, DEMO_WORKSPACE_ID))).limit(1);
      if (!tool) throw new PublicToolRejected("unavailable", "管理结果暂时无法确认");
      const [key] = previous.keyId ? await tx.select({ id: publicAgentToolKeys.id, name: publicAgentToolKeys.name,
        expiresAt: publicAgentToolKeys.expiresAt, revokedAt: publicAgentToolKeys.revokedAt, createdAt: publicAgentToolKeys.createdAt,
      }).from(publicAgentToolKeys).where(and(eq(publicAgentToolKeys.id, previous.keyId), eq(publicAgentToolKeys.toolId, tool.id), eq(publicAgentToolKeys.workspaceId, DEMO_WORKSPACE_ID))).limit(1) : [];
      return PublicToolManageResult.parse({ ok: true, tool: presentPublicTool(tool), recordedRevision: previous.revision, ...(key ? { key: keyView(key) } : {}) });
    }
    const now = new Date();
    let tool: typeof publicAgentTools.$inferSelect | undefined;
    let key: ReturnType<typeof keyView> | undefined;
    let token: string | undefined;
    if (input.operation === "create") {
      const [count] = await tx.select({ value: sql<number>`count(*)`.mapWith(Number) }).from(publicAgentTools).where(eq(publicAgentTools.workspaceId, DEMO_WORKSPACE_ID));
      if (count.value >= 100) throw new PublicToolRejected("resource_limit", "本工作区公开工具数量已达到上限");
      [tool] = await tx.insert(publicAgentTools).values({ workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
        name: input.name, description: input.description, status: "draft", revision: 1,
      }).returning();
    } else {
      const [current] = await tx.select().from(publicAgentTools).where(and(eq(publicAgentTools.id, input.toolId),
        eq(publicAgentTools.workspaceId, DEMO_WORKSPACE_ID), isNull(publicAgentTools.archivedAt))).for("update").limit(1);
      if (!current) throw new PublicToolRejected("not_found", "找不到这个工具");
      if (current.revision !== input.expectedRevision) throw new PublicToolRejected("conflict", "工具设置已变化，请刷新后重试");
      let publication = current.publication;
      let status = current.status;
      if (input.operation === "publish") {
        const [version] = await tx.select({ agentId: agentVersions.agentId, versionId: agentVersions.id, version: agentVersions.version,
          status: agentVersions.status, manifest: agentVersions.manifest,
        }).from(agentVersions).innerJoin(agents, and(eq(agents.id, agentVersions.agentId), eq(agents.workspaceId, agentVersions.workspaceId)))
          .where(and(eq(agentVersions.id, input.versionId), eq(agentVersions.agentId, input.agentId),
            eq(agentVersions.workspaceId, DEMO_WORKSPACE_ID), eq(agents.workspaceId, DEMO_WORKSPACE_ID), isNull(agents.archivedAt))).for("share").limit(1);
        if (!version || version.status !== "production") throw new PublicToolRejected("invalid", "请选择已经通过发布门禁的上线版本");
        try { publication = freezePublicToolPublication({ ...version, publicationId: randomUUID(), now }); }
        catch { throw new PublicToolRejected("invalid", "助手版本或最终交付字段未通过公开工具检查"); }
        status = "enabled";
      } else if (input.operation === "disable") status = "disabled";
      else if (input.operation === "mint-key") {
        const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
        if (expiresAt && (expiresAt.getTime() <= now.getTime() || expiresAt.getTime() > now.getTime() + 365 * 86400_000)) {
          throw new PublicToolRejected("invalid", "凭据到期时间须在未来一年以内");
        }
        const [active] = await tx.select({ value: sql<number>`count(*)`.mapWith(Number) }).from(publicAgentToolKeys)
          .where(and(eq(publicAgentToolKeys.workspaceId, DEMO_WORKSPACE_ID), eq(publicAgentToolKeys.toolId, current.id),
            isNull(publicAgentToolKeys.revokedAt), isNull(publicAgentToolKeys.archivedAt),
            or(isNull(publicAgentToolKeys.expiresAt), sql`${publicAgentToolKeys.expiresAt} > ${now}`)));
        if (active.value >= 20) throw new PublicToolRejected("resource_limit", "工具有效凭据数量已达到上限，请先撤销旧凭据");
        token = `pat_${randomBytes(32).toString("hex")}`;
        const [savedKey] = await tx.insert(publicAgentToolKeys).values({ toolId: current.id, workspaceId: DEMO_WORKSPACE_ID,
          createdBy: DEMO_USER_ID, name: input.name, tokenHash: publicToolHash(token), expiresAt,
        }).returning({ id: publicAgentToolKeys.id, name: publicAgentToolKeys.name, expiresAt: publicAgentToolKeys.expiresAt,
          revokedAt: publicAgentToolKeys.revokedAt, createdAt: publicAgentToolKeys.createdAt });
        key = keyView(savedKey);
      } else {
        const [savedKey] = await tx.update(publicAgentToolKeys).set({ revokedAt: now, updatedAt: now })
          .where(and(eq(publicAgentToolKeys.id, input.keyId), eq(publicAgentToolKeys.toolId, current.id), eq(publicAgentToolKeys.workspaceId, DEMO_WORKSPACE_ID)))
          .returning({ id: publicAgentToolKeys.id, name: publicAgentToolKeys.name, expiresAt: publicAgentToolKeys.expiresAt,
            revokedAt: publicAgentToolKeys.revokedAt, createdAt: publicAgentToolKeys.createdAt });
        if (!savedKey) throw new PublicToolRejected("not_found", "找不到这个工具的凭据");
        key = keyView(savedKey);
      }
      [tool] = await tx.update(publicAgentTools).set({ publication, status, revision: current.revision + 1, updatedAt: now })
        .where(and(eq(publicAgentTools.id, current.id), eq(publicAgentTools.workspaceId, DEMO_WORKSPACE_ID), eq(publicAgentTools.revision, current.revision))).returning();
    }
    if (!tool) throw new PublicToolRejected("unavailable", "管理结果暂时无法确认");
    await tx.insert(publicAgentToolChanges).values({ workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, toolId: tool.id,
      requestId: input.requestId, requestHash, operation: input.operation, revision: tool.revision, keyId: key?.keyId });
    return PublicToolManageResult.parse({ ok: true, tool: presentPublicTool(tool), recordedRevision: tool.revision,
      ...(key ? { key } : {}), ...(token ? { token } : {}) });
  });
}
export async function admitPublicToolCall(token: string, toolId: string, input: PublicToolCallInput): Promise<StoredCall> {
  if (!/^pat_[a-f0-9]{64}$/.test(token)) throw new PublicToolRejected("unauthorized", "工具调用凭据无效或已停用");
  let requestHash: string;
  try { requestHash = publicToolInputHash(input.input); } catch { throw new PublicToolRejected("invalid", "工具输入无效或包含凭据"); }
  return db.transaction(async (tx) => {
    await lockExecutionWorkspace(tx, DEMO_WORKSPACE_ID);
    const [authorization] = await tx.select({ keyId: publicAgentToolKeys.id, expiresAt: publicAgentToolKeys.expiresAt,
      status: publicAgentTools.status, publication: publicAgentTools.publication,
    }).from(publicAgentToolKeys).innerJoin(publicAgentTools, and(eq(publicAgentTools.id, publicAgentToolKeys.toolId), eq(publicAgentTools.workspaceId, publicAgentToolKeys.workspaceId)))
      .where(and(eq(publicAgentToolKeys.tokenHash, publicToolHash(token)), eq(publicAgentTools.id, toolId),
        eq(publicAgentToolKeys.workspaceId, DEMO_WORKSPACE_ID), eq(publicAgentTools.workspaceId, DEMO_WORKSPACE_ID),
        isNull(publicAgentToolKeys.revokedAt), isNull(publicAgentToolKeys.archivedAt), isNull(publicAgentTools.archivedAt))).limit(1);
    if (!authorization || authorization.status !== "enabled" || !authorization.publication
      || authorization.expiresAt && authorization.expiresAt.getTime() <= Date.now()) throw new PublicToolRejected("unauthorized", "工具调用凭据无效或已停用");
    const match = and(eq(publicAgentToolCalls.workspaceId, DEMO_WORKSPACE_ID), eq(publicAgentToolCalls.toolId, toolId), eq(publicAgentToolCalls.requestId, input.requestId));
    const [previous] = await tx.select().from(publicAgentToolCalls).where(match).limit(1);
    if (previous && previous.requestHash !== requestHash) throw new PublicToolRejected("conflict", "同一次工具请求不能更换输入");
    const publication = PublicToolPublication.parse(previous?.publication ?? authorization.publication);
    const inputIssue = publicToolInputIssue(publication, input.input);
    if (inputIssue) throw new PublicToolRejected("invalid", "输入与已冻结工具字段不一致");
    if (!previous?.runId) {
      const [version] = await tx.select({ manifest: agentVersions.manifest, status: agentVersions.status }).from(agentVersions)
        .innerJoin(agents, and(eq(agents.id, agentVersions.agentId), eq(agents.workspaceId, agentVersions.workspaceId)))
        .where(and(eq(agentVersions.id, publication.versionId), eq(agentVersions.agentId, publication.agentId),
          eq(agentVersions.workspaceId, DEMO_WORKSPACE_ID), eq(agents.workspaceId, DEMO_WORKSPACE_ID), isNull(agents.archivedAt))).for("share").limit(1);
      if (!version || !["production", "retired"].includes(version.status) || !publicToolPublicationMatches(publication, version.manifest)) {
        throw new PublicToolRejected("conflict", "原工具版本不可用，请由管理员核对");
      }
    }
    const row = previous ?? (await tx.insert(publicAgentToolCalls).values({ workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
      toolId, keyId: authorization.keyId, requestId: input.requestId, requestHash, origin: "public-agent-tool", publication,
    }).returning())[0];
    return PublicToolStoredCall.parse({ callId: row.id, toolId: row.toolId, requestId: row.requestId, requestHash: row.requestHash,
      origin: row.origin, publication: row.publication, runId: row.runId, receivedAt: row.createdAt.toISOString() });
  });
}
export async function bindPublicToolRun(call: StoredCall, runId: string): Promise<void> {
  const [bound] = await db.update(publicAgentToolCalls).set({ runId, updatedAt: new Date() }).where(and(
    eq(publicAgentToolCalls.id, call.callId), eq(publicAgentToolCalls.workspaceId, DEMO_WORKSPACE_ID),
    eq(publicAgentToolCalls.toolId, call.toolId), eq(publicAgentToolCalls.requestHash, call.requestHash),
    or(isNull(publicAgentToolCalls.runId), eq(publicAgentToolCalls.runId, runId)),
  )).returning({ id: publicAgentToolCalls.id });
  if (!bound) throw new PublicToolRejected("unavailable", "工具运行关联暂时无法确认");
}
