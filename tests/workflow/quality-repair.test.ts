import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { start } from "workflow/api";
import { AgentManifest } from "@/contracts/manifest";
import { runSteps, runs, traceEvents } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { agentRunWorkflow } from "@/server/workflows/agent-run";

const AGENT_ID = "00000000-0000-4000-8000-0000000000b7";
const VERSION_ID = "00000000-0000-4000-8000-0000000000b8";

const manifest = AgentManifest.parse({
  schemaVersion: "4.0",
  workflowFingerprint: "e".repeat(64),
  inputContract: { fields: [] },
  resourceSelection: { model: { modelId: "mock", mock: true } },
  designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
  workflowSnapshot: {
    id: "draft-quality-repair-test",
    startNodeId: "start",
    rootAgent: { id: "agt_quality_test", name: "质量返工测试助手", role: "业务助手" },
    memoryPolicy: { taskContext: true, longTerm: false },
    nodes: {
      start: { id: "start", title: "收到任务", type: "trigger", next: "quality", requirementIds: [] },
      draft: { id: "draft", title: "生成交付方案", type: "ai", next: "quality", retry: { maxAttempts: 2, backoffMs: 100 }, requirementIds: [] },
      quality: {
        id: "quality", title: "交付前检查", type: "rule", next: "done", requirementIds: [],
        quality: { requiredOutputTitles: ["生成交付方案"], minOutputCount: 1, checkToolReceipts: false, checkHumanBoundary: false },
      },
      done: { id: "done", title: "完成", type: "end", next: null, requirementIds: [] },
    },
  },
});

async function cleanup(runId: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await db.delete(traceEvents).where(eq(traceEvents.runId, runId));
      await db.delete(runSteps).where(eq(runSteps.runId, runId));
      await db.delete(runs).where(eq(runs.id, runId));
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw lastError;
}

describe("质量检查自动返工", () => {
  it("缺少智能处理结果时自动重写，再次检查通过后完成", async () => {
    const [row] = await db.insert(runs).values({
      workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, agentId: AGENT_ID,
      versionId: VERSION_ID, status: "queued", input: { input: "生成方案" },
    }).returning({ id: runs.id });
    try {
      const handle = await start(agentRunWorkflow, [row.id, manifest, { input: "生成方案" }]);
      await expect(handle.returnValue).resolves.toEqual({ status: "completed" });
    } finally {
      await cleanup(row.id);
    }
  }, 240_000);
});
