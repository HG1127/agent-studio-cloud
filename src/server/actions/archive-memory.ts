"use server";

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { MemoryArchiveInput, type MemoryArchiveResult } from "@/contracts/memory";
import { agentMemories } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";

export async function setMemoryArchivedAction(input: MemoryArchiveInput): Promise<MemoryArchiveResult> {
  const parsed = MemoryArchiveInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "经验信息不正确，请刷新页面后重试" };
  try {
    const [updated] = await db
      .update(agentMemories)
      .set({ archivedAt: parsed.data.archived ? new Date() : null, updatedAt: new Date() })
      .where(and(
        eq(agentMemories.id, parsed.data.memoryId),
        eq(agentMemories.workspaceId, DEMO_WORKSPACE_ID),
        parsed.data.archived ? isNull(agentMemories.archivedAt) : isNotNull(agentMemories.archivedAt),
      ))
      .returning({ id: agentMemories.id });
    if (!updated) return { ok: false, error: "经验状态已经变化，请刷新页面后重试" };
    revalidatePath("/memory");
    return { ok: true };
  } catch {
    return { ok: false, error: parsed.data.archived ? "停用经验失败，请稍后重试" : "恢复经验失败，请稍后重试" };
  }
}
