import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { PublicToolAuthorization, PublicToolStoredCall, type PublicToolCallReceipt, type PublicToolView } from "@/contracts/public-agent-tool";
import { publicAgentTools, publicAgentToolKeys, publicAgentToolCalls, agentVersions, runs } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { presentPublicTool, presentPublicToolCall, publicToolHash, publicToolSourceKey, publicToolPublicationMatches } from "@/server/domain/public-agent-tool";

export async function authorizePublicTool(token: string, toolId: string): Promise<PublicToolAuthorization | null> {
  if (!/^pat_[a-f0-9]{64}$/.test(token)) return null;
  const [row] = await db.select({ toolId: publicAgentTools.id, keyId: publicAgentToolKeys.id, workspaceId: publicAgentTools.workspaceId,
    status: publicAgentTools.status, publication: publicAgentTools.publication, expiresAt: publicAgentToolKeys.expiresAt,
  }).from(publicAgentToolKeys).innerJoin(publicAgentTools, and(eq(publicAgentTools.id, publicAgentToolKeys.toolId), eq(publicAgentTools.workspaceId, publicAgentToolKeys.workspaceId)))
    .where(and(eq(publicAgentToolKeys.tokenHash, publicToolHash(token)), eq(publicAgentTools.id, toolId),
      eq(publicAgentTools.workspaceId, DEMO_WORKSPACE_ID), eq(publicAgentToolKeys.workspaceId, DEMO_WORKSPACE_ID),
      isNull(publicAgentToolKeys.revokedAt), isNull(publicAgentToolKeys.archivedAt), isNull(publicAgentTools.archivedAt))).limit(1);
  if (!row || row.status !== "enabled" || !row.publication || row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;
  return PublicToolAuthorization.parse({ toolId: row.toolId, keyId: row.keyId, workspaceId: row.workspaceId });
}
export async function listPublicTools(): Promise<{ tools: PublicToolView[]; truncated: boolean }> {
  const rows = await db.select({ id: publicAgentTools.id, name: publicAgentTools.name, description: publicAgentTools.description,
    status: publicAgentTools.status, revision: publicAgentTools.revision, publication: publicAgentTools.publication,
    createdAt: publicAgentTools.createdAt, updatedAt: publicAgentTools.updatedAt,
  }).from(publicAgentTools).where(and(eq(publicAgentTools.workspaceId, DEMO_WORKSPACE_ID), isNull(publicAgentTools.archivedAt)))
    .orderBy(desc(publicAgentTools.createdAt), desc(publicAgentTools.id)).limit(101);
  return { tools: rows.slice(0, 100).map(presentPublicTool), truncated: rows.length > 100 };
}
export async function getPublicTool(toolId: string): Promise<PublicToolView | null> {
  const [row] = await db.select({ id: publicAgentTools.id, name: publicAgentTools.name, description: publicAgentTools.description,
    status: publicAgentTools.status, revision: publicAgentTools.revision, publication: publicAgentTools.publication,
    createdAt: publicAgentTools.createdAt, updatedAt: publicAgentTools.updatedAt,
  }).from(publicAgentTools).where(and(eq(publicAgentTools.id, toolId), eq(publicAgentTools.workspaceId, DEMO_WORKSPACE_ID), isNull(publicAgentTools.archivedAt))).limit(1);
  return row ? presentPublicTool(row) : null;
}
export async function getPublicToolStoredCall(toolId: string, requestId: string): Promise<PublicToolStoredCall | null> {
  const [row] = await db.select({ callId: publicAgentToolCalls.id, toolId: publicAgentToolCalls.toolId, requestId: publicAgentToolCalls.requestId,
    origin: publicAgentToolCalls.origin, requestHash: publicAgentToolCalls.requestHash, publication: publicAgentToolCalls.publication,
    runId: publicAgentToolCalls.runId, createdAt: publicAgentToolCalls.createdAt,
  }).from(publicAgentToolCalls).where(and(eq(publicAgentToolCalls.toolId, toolId), eq(publicAgentToolCalls.requestId, requestId),
    eq(publicAgentToolCalls.workspaceId, DEMO_WORKSPACE_ID))).limit(1);
  return row ? PublicToolStoredCall.parse({ callId: row.callId, toolId: row.toolId, requestId: row.requestId, origin: row.origin,
    requestHash: row.requestHash, publication: row.publication, runId: row.runId, receivedAt: row.createdAt.toISOString() }) : null;
}
export async function getPublicToolCallReceipt(call: PublicToolStoredCall): Promise<PublicToolCallReceipt> {
  const [run] = await db.select({ id: runs.id, agentId: runs.agentId, versionId: runs.versionId, sourceType: runs.sourceType,
    sourceKey: runs.sourceKey, status: runs.status, result: sql<unknown>`CASE WHEN ${runs.status} = 'completed' THEN ${runs.result} ELSE NULL END`, manifest: agentVersions.manifest,
  }).from(runs).leftJoin(agentVersions, and(eq(agentVersions.id, runs.versionId), eq(agentVersions.workspaceId, runs.workspaceId), eq(agentVersions.agentId, runs.agentId)))
    .where(and(eq(runs.workspaceId, DEMO_WORKSPACE_ID),
      or(eq(runs.sourceKey, publicToolSourceKey(call.toolId, call.requestId)), ...(call.runId ? [eq(runs.id, call.runId)] : [])))).limit(1);
  if (run && !publicToolPublicationMatches(call.publication, run.manifest)) return presentPublicToolCall({ ...call, runId: run.id }, null);
  return presentPublicToolCall(call, run ?? null);
}
