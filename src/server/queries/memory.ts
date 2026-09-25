import { and, desc, eq, ilike, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { MemoryAgentOption, MemoryView } from "@/contracts/memory";
import { agentMemories, agents, runFeedback } from "@/db/schema";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { parseQueryRows } from "@/server/queries/parse-query-rows";
import { escapeLikePattern } from "@/server/domain/search-pattern";
import { redactSensitiveText } from "@/server/domain/security/redact-sensitive";

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
      query ? ilike(agentMemories.content, `%${escapeLikePattern(query)}%`) : undefined,
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
    content: redactSensitiveText(memory.content),
    createdAt: memory.createdAt.toISOString(),
    archivedAt: memory.archivedAt?.toISOString() ?? null,
  })));
}

export async function listMemoryAgentOptions() {
  const [memoryRows, feedbackRows] = await Promise.all([
    db.selectDistinct({ id: agents.id, name: agents.name })
      .from(agentMemories)
      .innerJoin(agents, eq(agents.id, agentMemories.agentId))
      .where(and(eq(agentMemories.workspaceId, DEMO_WORKSPACE_ID), eq(agents.workspaceId, DEMO_WORKSPACE_ID))),
    db.selectDistinct({ id: agents.id, name: agents.name })
      .from(runFeedback)
      .innerJoin(agents, eq(agents.id, runFeedback.agentId))
      .where(and(eq(runFeedback.workspaceId, DEMO_WORKSPACE_ID), eq(agents.workspaceId, DEMO_WORKSPACE_ID))),
  ]);
  const rows = [...new Map([...memoryRows, ...feedbackRows].map((row) => [row.id, row])).values()]
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  return parseQueryRows("经验助手选项", MemoryAgentOption, rows);
}
