import { and, asc, desc, eq, ilike, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { MemoryAgentOption, MemoryView } from "@/contracts/memory";
import { agentMemories, agents } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { parseQueryRows } from "@/server/queries/parse-query-rows";

export async function listMemories(filters: {
  agentId?: string;
  query?: string;
  archived?: boolean;
  limit?: number;
  offset?: number;
} = {}) {
  const agentId = z.string().uuid().safeParse(filters.agentId).data;
  const query = filters.query?.trim().slice(0, 200);
  const limit = Math.min(101, Math.max(1, filters.limit ?? 100));
  const offset = Math.max(0, filters.offset ?? 0);
  const rows = await db
    .select({ memory: agentMemories, agentName: agents.name })
    .from(agentMemories)
    .innerJoin(agents, eq(agents.id, agentMemories.agentId))
    .where(and(
      eq(agentMemories.workspaceId, DEMO_WORKSPACE_ID),
      eq(agents.workspaceId, DEMO_WORKSPACE_ID),
      filters.archived ? isNotNull(agentMemories.archivedAt) : isNull(agentMemories.archivedAt),
      agentId ? eq(agentMemories.agentId, agentId) : undefined,
      query ? ilike(agentMemories.content, `%${query}%`) : undefined,
    ))
    .orderBy(desc(agentMemories.createdAt))
    .limit(limit)
    .offset(offset);
  return parseQueryRows("经验列表", MemoryView, rows.map(({ memory, agentName }) => ({
    id: memory.id,
    agentId: memory.agentId,
    agentName,
    sourceRunId: memory.sourceRunId,
    sourceNodeTitle: memory.metadata && typeof memory.metadata.nodeTitle === "string" ? memory.metadata.nodeTitle : "保存经验",
    content: memory.content,
    createdAt: memory.createdAt.toISOString(),
    archivedAt: memory.archivedAt?.toISOString() ?? null,
  })));
}

export async function listMemoryAgentOptions() {
  const rows = await db
    .selectDistinct({ id: agents.id, name: agents.name })
    .from(agentMemories)
    .innerJoin(agents, eq(agents.id, agentMemories.agentId))
    .where(and(eq(agentMemories.workspaceId, DEMO_WORKSPACE_ID), eq(agents.workspaceId, DEMO_WORKSPACE_ID)))
    .orderBy(asc(agents.name));
  return parseQueryRows("经验助手选项", MemoryAgentOption, rows);
}
