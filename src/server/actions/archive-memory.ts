"use server";

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { MemoryArchiveInput, type MemoryArchiveResult } from "@/contracts/memory";
import { agentMemories, agents, auditEvents } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { auditEventValues } from "@/server/audit/event-values";
import { safeErrorForLog } from "@/server/domain/security/safe-log-error";

export async function setMemoryArchivedAction(input: MemoryArchiveInput): Promise<MemoryArchiveResult> {
  const parsed = MemoryArchiveInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "经验信息不正确，请刷新页面后重试" };
  try {
    const updated = await db.transaction(async (tx) => {
      const [memory] = await tx
        .select({ id: agentMemories.id, agentName: agents.name })
        .from(agentMemories)
        .innerJoin(agents, and(eq(agents.id, agentMemories.agentId), eq(agents.workspaceId, agentMemories.workspaceId)))
        .where(and(
          eq(agentMemories.id, parsed.data.memoryId),
          eq(agentMemories.workspaceId, DEMO_WORKSPACE_ID),
          parsed.data.archived ? isNull(agentMemories.archivedAt) : isNotNull(agentMemories.archivedAt),
        ))
        .for("update")
        .limit(1);
      if (!memory) return false;
      const now = new Date();
      const [row] = await tx
        .update(agentMemories)
        .set({ archivedAt: parsed.data.archived ? now : null, updatedAt: now })
        .where(and(
          eq(agentMemories.id, memory.id),
          eq(agentMemories.workspaceId, DEMO_WORKSPACE_ID),
          parsed.data.archived ? isNull(agentMemories.archivedAt) : isNotNull(agentMemories.archivedAt),
        ))
        .returning({ id: agentMemories.id });
      if (!row) return false;
      await tx.insert(auditEvents).values(auditEventValues({
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        action: parsed.data.archived ? "memory.archived" : "memory.restored",
        targetType: "memory",
        targetId: memory.id,
        summary: `${parsed.data.archived ? "停用" : "恢复"}助手「${memory.agentName}」的一条经验`,
        data: {},
      }));
      return true;
    });
    if (!updated) return { ok: false, error: "经验状态已经变化，请刷新页面后重试" };
    revalidatePath("/memory");
    return { ok: true };
  } catch (error) {
    console.error("更新经验状态失败", safeErrorForLog(error));
    return { ok: false, error: parsed.data.archived ? "停用经验失败，请稍后重试" : "恢复经验失败，请稍后重试" };
  }
}
