import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { start } from "workflow/api";
import { WorkflowNode } from "@/contracts/workflow";
import { AgentManifest } from "@/contracts/manifest";
import { knowledgeChunks, knowledgeSources, runs, traceEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { knowledgeProbeWorkflow } from "./knowledge-probe.workflow";

const SOURCE_ID = "00000000-0000-4000-8000-0000000000f2";
const AGENT_ID = "00000000-0000-4000-8000-0000000000e3";
const VERSION_ID = "00000000-0000-4000-8000-0000000000e4";

const node = WorkflowNode.parse({
  id: "k1", title: "读取资料", type: "knowledge", next: "done", requirementIds: [],
  knowledge: { space: "客户资料", query: "退货政策" },
});

const manifest = AgentManifest.parse({
  schemaVersion: "4.0",
  workflowFingerprint: "e".repeat(64),
  inputContract: { fields: [] },
  resourceSelection: { model: { modelId: "mock", mock: true } },
  designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
  knowledgeSnapshot: [SOURCE_ID],
  workflowSnapshot: {
    id: "draft-m3-knowledge",
    startNodeId: "start",
    rootAgent: { id: "agt_m3_knowledge", name: "知识测试助手", role: "通用业务助手" },
    memoryPolicy: { taskContext: true, longTerm: false },
    nodes: {
      start: { id: "start", title: "收到任务", type: "trigger", next: "done", requirementIds: [] },
      done: { id: "done", title: "流程结束", type: "end", next: null, requirementIds: [] },
    },
  },
});

async function insertRun(): Promise<string> {
  const [row] = await db
    .insert(runs)
    .values({ workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, agentId: AGENT_ID, versionId: VERSION_ID, status: "queued", input: {} })
    .returning({ id: runs.id });
  return row.id;
}

describe("知识步骤真实现", () => {
  it("按快照检索返回证据摘录并落 knowledge.receipt 轨迹", async () => {
    const runId = await insertRun();
    await db.insert(knowledgeSources).values({
      id: SOURCE_ID, workspaceId: DEMO_WORKSPACE_ID, name: "售后手册", mime: "text/plain",
      sizeBytes: 10, sha256: `m3step-${SOURCE_ID}`, status: "indexed", chunkCount: 1, createdBy: DEMO_USER_ID,
    });
    await db.insert(knowledgeChunks).values({
      workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, sourceId: SOURCE_ID, chunkIndex: 0,
      content: "开头即说明退货政策：签收后 7 天内可退。", charStart: 0, charEnd: 20,
    });
    try {
      const handle = await start(knowledgeProbeWorkflow, [runId, node, manifest, {}]);
      const result = await handle.returnValue;
      expect(result.receipt.hitCount).toBe(1);
      expect(result.receipt).toMatchObject({ scannedCount: 1, truncated: false });
      expect(result.receipt.hits[0].excerpt).toContain("退货政策");
      const receiptTraces = await db
        .select()
        .from(traceEvents)
        .where(and(eq(traceEvents.runId, runId), eq(traceEvents.kind, "knowledge.receipt")));
      expect(receiptTraces).toHaveLength(1);
    } finally {
      await db.delete(knowledgeChunks).where(eq(knowledgeChunks.sourceId, SOURCE_ID));
      await db.delete(knowledgeSources).where(eq(knowledgeSources.id, SOURCE_ID));
      await db.delete(traceEvents).where(eq(traceEvents.runId, runId));
      await db.delete(runs).where(eq(runs.id, runId));
    }
  }, 240_000);

  it("零命中按 guardrail 失败：run 落 failed 且步骤失败原因可读", async () => {
    const runId = await insertRun();
    await db.insert(knowledgeSources).values({
      id: SOURCE_ID, workspaceId: DEMO_WORKSPACE_ID, name: "售后手册", mime: "text/plain",
      sizeBytes: 10, sha256: `m3step2-${SOURCE_ID}`, status: "indexed", chunkCount: 1, createdBy: DEMO_USER_ID,
    });
    await db.insert(knowledgeChunks).values({
      workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, sourceId: SOURCE_ID, chunkIndex: 0,
      content: "这里没有任何与问题相关的内容。", charStart: 0, charEnd: 15,
    });
    try {
      const handle = await start(knowledgeProbeWorkflow, [runId, node, manifest, {}]);
      await expect(handle.returnValue).rejects.toThrow();
      const [after] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
      expect(after?.status).toBe("failed");
      expect(after?.error).toContain("没有找到");
    } finally {
      await db.delete(knowledgeChunks).where(eq(knowledgeChunks.sourceId, SOURCE_ID));
      await db.delete(knowledgeSources).where(eq(knowledgeSources.id, SOURCE_ID));
      await db.delete(traceEvents).where(eq(traceEvents.runId, runId));
      await db.delete(runs).where(eq(runs.id, runId));
    }
  }, 240_000);
});
