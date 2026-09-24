"use server";

import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { AgentArchiveInput, type AgentArchiveResult } from "@/contracts/agent";
import { agents, schedules } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";

export async function setAgentArchivedAction(input: unknown): Promise<AgentArchiveResult> {
  const parsed = AgentArchiveInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "助手信息不正确，请刷新页面后重试" };

  try {
    const now = new Date();
    const updated = await db.transaction(async (tx) => {
      const rows = await tx
        .update(agents)
        .set({ archivedAt: parsed.data.archived ? now : null, updatedAt: now })
        .where(and(
          eq(agents.id, parsed.data.agentId),
          eq(agents.workspaceId, DEMO_WORKSPACE_ID),
          parsed.data.archived ? isNull(agents.archivedAt) : isNotNull(agents.archivedAt),
        ))
        .returning({ id: agents.id });
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
      return true;
    });
    if (!updated) return { ok: false, error: "助手状态已经变化，请刷新页面后重试" };
    revalidatePath("/agents");
    revalidatePath(`/agents/${parsed.data.agentId}`);
    revalidatePath("/schedules");
    return { ok: true };
  } catch (error) {
    console.error("更新助手状态失败", error);
    return { ok: false, error: "更新助手状态失败，请稍后重试" };
  }
}
