import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { MemoryMetadata } from "@/contracts/memory";

export const agentMemories = pgTable(
  "agent_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    createdBy: uuid("created_by").notNull(),
    agentId: uuid("agent_id").notNull(),
    sourceRunId: uuid("source_run_id").notNull(),
    sourceNodeId: text("source_node_id").notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<MemoryMetadata>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("agent_memories_run_node_unique").on(t.sourceRunId, t.sourceNodeId),
    index("agent_memories_workspace_agent_idx").on(t.workspaceId, t.agentId, t.createdAt),
  ],
);
export type AgentMemory = typeof agentMemories.$inferSelect;
