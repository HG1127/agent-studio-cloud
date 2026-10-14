import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { PublicToolKeyView } from "@/contracts/public-agent-tool";
import {
  MAX_PUBLIC_TOOL_KEY_MANAGEMENT_ITEMS, PublicToolKeyManagementInput, PublicToolKeyManagementView,
} from "@/contracts/public-tool-key-management";
import { publicAgentToolKeys, publicAgentTools } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { presentPublicTool, publicToolHasCredentials } from "@/server/domain/public-agent-tool";

export async function getPublicToolKeys(raw: PublicToolKeyManagementInput): Promise<PublicToolKeyManagementView | null> {
  const reference = PublicToolKeyManagementInput.parse(raw);
  return db.transaction(async (tx) => {
    const [tool] = await tx.select({
      id: publicAgentTools.id, name: publicAgentTools.name, description: publicAgentTools.description,
      status: publicAgentTools.status, revision: publicAgentTools.revision, publication: publicAgentTools.publication,
      createdAt: publicAgentTools.createdAt, updatedAt: publicAgentTools.updatedAt,
    }).from(publicAgentTools).where(and(eq(publicAgentTools.id, reference.toolId),
      eq(publicAgentTools.workspaceId, DEMO_WORKSPACE_ID), isNull(publicAgentTools.archivedAt))).limit(1);
    if (!tool) return null;
    const rows = await tx.select({
      keyId: publicAgentToolKeys.id, name: publicAgentToolKeys.name, expiresAt: publicAgentToolKeys.expiresAt,
      revokedAt: publicAgentToolKeys.revokedAt, createdAt: publicAgentToolKeys.createdAt,
    }).from(publicAgentToolKeys).where(and(eq(publicAgentToolKeys.toolId, reference.toolId),
      eq(publicAgentToolKeys.workspaceId, DEMO_WORKSPACE_ID), isNull(publicAgentToolKeys.archivedAt)))
      // 有效旧凭据不应被较新的撤销历史挤出清单；事务时刻对所有行一致。
      .orderBy(desc(sql<number>`CASE WHEN ${publicAgentToolKeys.revokedAt} IS NULL
        AND (${publicAgentToolKeys.expiresAt} IS NULL OR ${publicAgentToolKeys.expiresAt} > CURRENT_TIMESTAMP)
        THEN 1 ELSE 0 END`), desc(publicAgentToolKeys.createdAt), desc(publicAgentToolKeys.id))
      .limit(MAX_PUBLIC_TOOL_KEY_MANAGEMENT_ITEMS + 1);
    const view = PublicToolKeyManagementView.parse({
      tool: presentPublicTool(tool),
      keys: rows.slice(0, MAX_PUBLIC_TOOL_KEY_MANAGEMENT_ITEMS).map((row) => PublicToolKeyView.parse({
        keyId: row.keyId, name: row.name, expiresAt: row.expiresAt?.toISOString() ?? null,
        revokedAt: row.revokedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(),
      })),
      truncated: rows.length > MAX_PUBLIC_TOOL_KEY_MANAGEMENT_ITEMS,
    });
    if (publicToolHasCredentials(view)) throw new Error("工具凭据元数据无效");
    return view;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
