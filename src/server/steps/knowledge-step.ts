"use step";
// 知识步骤：按发布时冻结的 manifest.knowledgeSnapshot 检索（domain 纯函数打分）；
// 正式 run 零命中走 guardrail 失败（旧系统口径：不许演示数据兜底）。
import { FatalError } from "workflow";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { AgentManifest } from "@/contracts/manifest";
import type { WorkflowNode } from "@/contracts/workflow";
import { knowledgeChunks, knowledgeSources, runs } from "@/db/schema";
import { db } from "@/lib/db";
import { MAX_KNOWLEDGE_SCAN_CHUNKS, scoreChunks } from "@/server/domain/knowledge/search";
import { persistStep } from "@/server/steps/run-state";
import { appendTrace } from "@/server/steps/trace-step";

export interface RunKnowledgeStepInput {
  runId: string;
  node: WorkflowNode;
  manifest: AgentManifest;
  input: Record<string, unknown>;
}

export type KnowledgeReceipt = {
  ok: true;
  space: string;
  query: string;
  scannedCount: number;
  truncated: boolean;
  hitCount: number;
  hits: Array<{ source: string; chunkIndex: number; excerpt: string; score: number }>;
};

export async function runKnowledgeStep(args: RunKnowledgeStepInput): Promise<{ receipt: KnowledgeReceipt }> {
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
  const fromNode = node.knowledge?.query?.trim() ?? "";
  const fromInput = typeof input.question === "string" ? input.question.trim() : "";
  const query = (fromNode || fromInput || JSON.stringify(input).slice(0, 200)).trim();
  const snapshot = manifest.knowledgeSnapshot ?? [];
  if (snapshot.length === 0) {
    return reject(`步骤「${node.title}」发布时没有可用知识来源，请先在知识库上传文档并重新发布`);
  }
  const [run] = await db.select({ workspaceId: runs.workspaceId }).from(runs).where(eq(runs.id, args.runId)).limit(1);
  if (!run) return reject("找不到这次运行");
  const rows = await db
    .select({ sourceId: knowledgeChunks.sourceId, sourceName: knowledgeSources.name, chunkIndex: knowledgeChunks.chunkIndex, content: knowledgeChunks.content })
    .from(knowledgeChunks)
    .innerJoin(knowledgeSources, eq(knowledgeChunks.sourceId, knowledgeSources.id))
    .where(
      and(
        inArray(knowledgeChunks.sourceId, snapshot),
        eq(knowledgeChunks.workspaceId, run.workspaceId),
        eq(knowledgeSources.status, "indexed"),
        isNull(knowledgeSources.archivedAt),
      ),
    )
    .orderBy(desc(knowledgeSources.createdAt), asc(knowledgeSources.id), asc(knowledgeChunks.chunkIndex))
    .limit(MAX_KNOWLEDGE_SCAN_CHUNKS + 1);
  const truncated = rows.length > MAX_KNOWLEDGE_SCAN_CHUNKS;
  const scannedRows = rows.slice(0, MAX_KNOWLEDGE_SCAN_CHUNKS);
  const hits = scoreChunks(query, scannedRows, { limit: 8 });
  if (hits.length === 0) {
    return reject(truncated
      ? `步骤「${node.title}」仅检查了最近 ${MAX_KNOWLEDGE_SCAN_CHUNKS} 个资料分片，没有找到与任务相关的内容；请缩小已发布资料范围后重试`
      : `步骤「${node.title}」在知识库中没有找到与任务相关的内容`);
  }
  const receipt: KnowledgeReceipt = {
    ok: true,
    space,
    query,
    scannedCount: scannedRows.length,
    truncated,
    hitCount: hits.length,
    hits: hits.map((hit) => ({ source: hit.sourceName, chunkIndex: hit.chunkIndex, excerpt: hit.excerpt, score: hit.score })),
  };
  await persistStep({ runId: args.runId, nodeId: node.id, nodeTitle: node.title, nodeType: node.type, status: "succeeded", output: receipt });
  await appendTrace({
    runId: args.runId,
    nodeId: node.id,
    kind: "knowledge.receipt",
    title: `「${node.title}」已从知识库找到 ${hits.length} 条相关内容`,
    detail: truncated ? `资料较多，本次只检查了最近 ${MAX_KNOWLEDGE_SCAN_CHUNKS} 个分片` : null,
    data: receipt,
  });
  return { receipt };
}
