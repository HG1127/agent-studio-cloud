"use step";
// 知识步骤：按发布时冻结的 manifest.knowledgeSnapshot 检索（domain 纯函数打分）；
// 正式 run 零命中走 guardrail 失败（旧系统口径：不许演示数据兜底）。
import { FatalError } from "workflow";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { AgentManifest } from "@/contracts/manifest";
import type { WorkflowNode } from "@/contracts/workflow";
import type { InlineOutputReferences } from "@/contracts/inline-output-reference";
import { KnowledgeReceipt, type KnowledgeReceipt as KnowledgeReceiptType } from "@/contracts/knowledge";
import { knowledgeChunks, knowledgeSources, runs } from "@/db/schema";
import { db } from "@/lib/db";
import { MAX_KNOWLEDGE_SCAN_CHUNKS, scoreChunks } from "@/server/domain/knowledge/search";
import { knowledgeSourceIdsForStep } from "@/server/domain/runtime/knowledge-snapshot";
import { resolveKnowledgeQuery } from "@/server/domain/runtime/knowledge-query";
import { persistStep } from "@/server/steps/run-state";
import { appendTrace } from "@/server/steps/trace-step";
import { withSafeWorkflowError } from "@/server/security/workflow-error";
import { knowledgeCandidateFilter, knowledgeExactMatchFilter } from "@/db/knowledge-candidate-filter";

export interface RunKnowledgeStepInput {
  runId: string;
  node: WorkflowNode;
  manifest: AgentManifest;
  input: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  inlineReferences?: InlineOutputReferences;
  currentItem?: unknown;
}

export type { KnowledgeReceipt } from "@/contracts/knowledge";

export async function runKnowledgeStep(args: RunKnowledgeStepInput): Promise<{ receipt: KnowledgeReceiptType }> {
  "use step";
  const { node, manifest, input } = args;
  const reject = async (reason: string): Promise<never> => {
    await persistStep({ runId: args.runId, nodeId: node.id, nodeTitle: node.title, nodeType: node.type, status: "failed", error: reason });
    await appendTrace({ runId: args.runId, nodeId: node.id, kind: "step.failed", level: "error", title: `「${node.title}」无法执行`, detail: reason });
    throw new FatalError(reason);
  };
  await appendTrace({ runId: args.runId, nodeId: node.id, kind: "step.started", title: `开始「${node.title}」`, detail: node.description ?? null });
  await persistStep({ runId: args.runId, nodeId: node.id, nodeTitle: node.title, nodeType: node.type, status: "running" });

  const space = node.knowledge?.space?.trim() ?? "";
  if (!space) return reject(`步骤「${node.title}」知识来源未绑定`);
  const resolvedQuery = resolveKnowledgeQuery({ node, input, outputs: args.outputs, currentItem: args.currentItem, inlineReferences: args.inlineReferences });
  if (!resolvedQuery.ok) return reject(resolvedQuery.error);
  const query = resolvedQuery.query;
  const snapshot = manifest.knowledgeSnapshot ?? [];
  if (snapshot.length === 0) {
    return reject(`步骤「${node.title}」发布时没有可用知识来源，请先在知识库上传文档并重新发布`);
  }
  const configuredSourceIds = node.knowledge?.sourceIds ?? [];
  const selectedSourceIds = knowledgeSourceIdsForStep(snapshot, configuredSourceIds);
  if (selectedSourceIds.length === 0) {
    return reject(`步骤「${node.title}」选择的知识来源不在这个发布版本中，请重新发布`);
  }
  const [run] = await withSafeWorkflowError(
    () => db.select({ workspaceId: runs.workspaceId }).from(runs).where(eq(runs.id, args.runId)).limit(1),
    "知识检索暂时不可用，请稍后重试",
  );
  if (!run) return reject("找不到这次运行");
  const rows = await withSafeWorkflowError(() => db
    .select({ sourceId: knowledgeChunks.sourceId, sourceName: knowledgeSources.name, chunkIndex: knowledgeChunks.chunkIndex, content: knowledgeChunks.content })
    .from(knowledgeChunks)
    .innerJoin(knowledgeSources, eq(knowledgeChunks.sourceId, knowledgeSources.id))
    .where(
      and(
        inArray(knowledgeChunks.sourceId, selectedSourceIds),
        eq(knowledgeChunks.workspaceId, run.workspaceId),
        eq(knowledgeSources.workspaceId, run.workspaceId),
        eq(knowledgeSources.status, "indexed"),
        isNull(knowledgeSources.archivedAt),
        knowledgeCandidateFilter(query),
      ),
    )
    .orderBy(desc(knowledgeExactMatchFilter(query)), desc(knowledgeSources.createdAt), asc(knowledgeSources.id), asc(knowledgeChunks.chunkIndex))
    .limit(MAX_KNOWLEDGE_SCAN_CHUNKS + 1), "知识检索暂时不可用，请稍后重试");
  const truncated = rows.length > MAX_KNOWLEDGE_SCAN_CHUNKS;
  const scannedRows = rows.slice(0, MAX_KNOWLEDGE_SCAN_CHUNKS);
  const hits = scoreChunks(query, scannedRows, { limit: 8 });
  if (hits.length === 0) {
    return reject(truncated
      ? `步骤「${node.title}」仅检查了最近 ${MAX_KNOWLEDGE_SCAN_CHUNKS} 个匹配查询词的资料分片，没有找到与任务相关的内容；请缩小已发布资料范围后重试`
      : `步骤「${node.title}」在知识库中没有找到与任务相关的内容`);
  }
  const receipt = KnowledgeReceipt.parse({
    ok: true,
    space,
    query,
    scannedCount: scannedRows.length,
    truncated,
    hitCount: hits.length,
    hits: hits.map((hit) => ({ source: hit.sourceName, chunkIndex: hit.chunkIndex, excerpt: hit.excerpt, score: hit.score })),
  });
  await persistStep({ runId: args.runId, nodeId: node.id, nodeTitle: node.title, nodeType: node.type, status: "succeeded", output: receipt });
  await appendTrace({
    runId: args.runId,
    nodeId: node.id,
    kind: "knowledge.receipt",
    title: `「${node.title}」已从知识库找到 ${hits.length} 条相关内容`,
    detail: truncated ? `匹配查询词的资料较多，本次只检查了最近 ${MAX_KNOWLEDGE_SCAN_CHUNKS} 个分片` : null,
    data: { scannedCount: receipt.scannedCount, truncated: receipt.truncated, hitCount: receipt.hitCount },
  });
  return { receipt };
}
