import { and, asc, desc, eq, ilike, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { MemoryAgentOption, MemoryView } from "@/contracts/memory";
import { agentMemories, agents } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";

export async function listMemories(filters: { agentId?: string; query?: string; archived?: boolean } = {}) {
  const agentId = z.string().uuid().safeParse(filters.agentId).data;
  const query = filters.query?.trim().slice(0, 200);
  const rows = await db
    .select({ memory: agentMemories, agentName: agents.name })
    .from(agentMemories)
    .innerJoin(agents, eq(agents.id, agentMemories.agentId))
    .where(and(
      eq(agentMemories.workspaceId, DEMO_WORKSPACE_ID),
      filters.archived ? isNotNull(agentMemories.archivedAt) : isNull(agentMemories.archivedAt),
      agentId ? eq(agentMemories.agentId, agentId) : undefined,
      query ? ilike(agentMemories.content, `%${query}%`) : undefined,
    ))
    .orderBy(desc(agentMemories.createdAt))
    .limit(100);
  return rows.map(({ memory, agentName }) => MemoryView.parse({
    id: memory.id,
    agentId: memory.agentId,
    agentName,
    sourceRunId: memory.sourceRunId,
    sourceNodeTitle: typeof memory.metadata.nodeTitle === "string" ? memory.metadata.nodeTitle : "保存经验",
    content: memory.content,
    createdAt: memory.createdAt.toISOString(),
    archivedAt: memory.archivedAt?.toISOString() ?? null,
  }));
}

export async function listMemoryAgentOptions() {
  const rows = await db
    .selectDistinct({ id: agents.id, name: agents.name })
    .from(agentMemories)
    .innerJoin(agents, eq(agents.id, agentMemories.agentId))
    .where(eq(agentMemories.workspaceId, DEMO_WORKSPACE_ID))
    .orderBy(asc(agents.name));
  return rows.map((row) => MemoryAgentOption.parse(row));
}
