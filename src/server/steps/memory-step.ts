"use step";
import { and, desc, eq, isNull } from "drizzle-orm";
import { FatalError, getStepMetadata } from "workflow";
import type { WorkflowNode } from "@/contracts/workflow";
import { MemoryMetadata } from "@/contracts/memory";
import { agentMemories, runs } from "@/db/schema";
import { db } from "@/lib/db";
import { buildMemoryContent } from "@/server/domain/memory/memory-content";
import { selectRelevantMemories } from "@/server/domain/memory/memory-search";
import { searchQueryFromInput } from "@/server/domain/runtime/search-query";
import { redactSensitiveText } from "@/server/domain/security/redact-sensitive";
import { persistStep } from "@/server/steps/run-state";
import { appendTrace } from "@/server/steps/trace-step";
import { withSafeWorkflowError } from "@/server/security/workflow-error";
import { memoryCandidateFilter, memoryExactMatchFilter } from "@/db/memory-candidate-filter";

export async function runMemoryStep(args: {
  runId: string;
  node: WorkflowNode;
  input: Record<string, unknown>;
  outputs: Record<string, unknown>;
}): Promise<{ output: Record<string, unknown> }> {
  "use step";
  const memory = args.node.memory;
  if (!memory) throw new FatalError(`步骤「${args.node.title}」的经验设置不完整`);
  await persistStep({ runId: args.runId, nodeId: args.node.id, nodeTitle: args.node.title, nodeType: args.node.type, status: "running" });

  if (memory.mode === "read") {
    const [run] = await withSafeWorkflowError(() => db
      .select({ workspaceId: runs.workspaceId, agentId: runs.agentId })
      .from(runs)
      .where(eq(runs.id, args.runId))
      .limit(1), "经验内容暂时无法读取，请稍后重试");
    if (!run) throw new FatalError("找不到这次运行");
    const query = memory.query?.trim()
      || searchQueryFromInput(args.input);
    const exactMatch = memoryExactMatchFilter(query);
    const rows = await withSafeWorkflowError(() => db
      .select({ content: agentMemories.content, createdAt: agentMemories.createdAt })
      .from(agentMemories)
      .where(and(
        eq(agentMemories.workspaceId, run.workspaceId),
        eq(agentMemories.agentId, run.agentId),
        isNull(agentMemories.archivedAt),
        memoryCandidateFilter(query),
      ))
      .orderBy(...(exactMatch ? [desc(exactMatch)] : []), desc(agentMemories.createdAt), desc(agentMemories.id))
      .limit(100), "经验内容暂时无法读取，请稍后重试");
    const selected = selectRelevantMemories(query, rows, memory.limit ?? 5);
    const output = {
      mode: "read",
      query,
      foundCount: selected.length,
      memories: selected.map((item) => ({
        content: redactSensitiveText(item.content),
        savedAt: item.createdAt.toISOString(),
      })),
    };
    await persistStep({ runId: args.runId, nodeId: args.node.id, nodeTitle: args.node.title, nodeType: args.node.type, status: "succeeded", output });
    await appendTrace({
      runId: args.runId,
      nodeId: args.node.id,
      kind: "memory.read",
      title: selected.length > 0 ? `「${args.node.title}」找到 ${selected.length} 条可参考经验` : `「${args.node.title}」没有找到相关经验`,
      data: { foundCount: selected.length },
    });
    return { output };
  }

  const content = buildMemoryContent({ contentFrom: memory.contentFrom, input: args.input, outputs: args.outputs });
  if (content === null) {
    throw new FatalError(`步骤「${args.node.title}」指定的经验内容来源“${memory.contentFrom}”不存在`);
  }
  const sourceNodeId = `${args.node.id}:${getStepMetadata().stepId}`;
  const metadata = MemoryMetadata.parse({ nodeTitle: args.node.title });
  await withSafeWorkflowError(() => db.transaction(async (tx) => {
    const [run] = await tx
      .select({ workspaceId: runs.workspaceId, createdBy: runs.createdBy, agentId: runs.agentId, status: runs.status })
      .from(runs)
      .where(eq(runs.id, args.runId))
      .for("update")
      .limit(1);
    if (!run) throw new FatalError("找不到这次运行");
    if (!["queued", "running", "waiting_approval", "waiting_event"].includes(run.status)) {
      throw new FatalError("运行已经结束，不能再保存经验");
    }
    await tx
      .insert(agentMemories)
      .values({
        workspaceId: run.workspaceId,
        createdBy: run.createdBy,
        agentId: run.agentId,
        sourceRunId: args.runId,
        sourceNodeId,
        content,
        metadata,
      })
      .onConflictDoUpdate({
        target: [agentMemories.sourceRunId, agentMemories.sourceNodeId],
        set: { content, metadata, updatedAt: new Date() },
      });
  }), "经验内容暂时无法保存，请稍后重试");
  const output = { mode: "write", saved: true, contentLength: content.length };
  await persistStep({ runId: args.runId, nodeId: args.node.id, nodeTitle: args.node.title, nodeType: args.node.type, status: "succeeded", output });
  await appendTrace({ runId: args.runId, nodeId: args.node.id, kind: "memory.saved", title: `「${args.node.title}」已保存可复用经验`, data: output });
  return { output };
}
