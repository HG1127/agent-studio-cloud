import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { start } from "workflow/api";
import { AgentManifest } from "@/contracts/manifest";
import { runSteps, runs, traceEvents } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { agentRunWorkflow } from "@/server/workflows/agent-run";

const AGENT_ID = "00000000-0000-4000-8000-0000000000c3";
const VERSION_ID = "00000000-0000-4000-8000-0000000000c4";

const manifest = AgentManifest.parse({
  schemaVersion: "4.0",
  workflowFingerprint: "d".repeat(64),
  inputContract: { fields: [] },
  resourceSelection: { model: { modelId: "mock", mock: true } },
  designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
  workflowSnapshot: {
    id: "draft-loop-runtime-test",
    startNodeId: "start",
    rootAgent: { id: "agt_loop_test", name: "循环测试助手", role: "通用业务助手" },
    memoryPolicy: { taskContext: true, longTerm: false },
    nodes: {
      start: { id: "start", title: "收到任务", type: "trigger", next: "loop", requirementIds: [] },
      loop: {
        id: "loop",
        title: "逐项处理客户",
        type: "loop",
        next: null,
        loop: { collectionPath: "input.customers", itemKey: "currentItem", maxIterations: 3, bodyNext: "check", exitNext: "done" },
        requirementIds: [],
      },
      check: {
        id: "check",
        title: "判断客户优先级",
        type: "condition",
        next: null,
        condition: {
          source: "context.currentItem.priority",
          operator: "eq",
          branches: [{ label: "高优先级", value: "high", next: "handle" }],
          defaultNext: "loop",
        },
        requirementIds: [],
      },
      handle: {
        id: "handle",
        title: "处理高优先级客户",
        type: "ai",
        next: "loop",
        requirementIds: [],
      },
      done: { id: "done", title: "流程结束", type: "end", next: null, requirementIds: [] },
    },
  },
});

async function runWith(input: Record<string, unknown>) {
  const [row] = await db.insert(runs).values({
    workspaceId: DEMO_WORKSPACE_ID,
    createdBy: DEMO_USER_ID,
    agentId: AGENT_ID,
    versionId: VERSION_ID,
    status: "queued",
    input,
  }).returning({ id: runs.id });
  const handle = await start(agentRunWorkflow, [row.id, manifest, input]);
  await handle.returnValue;
  return row.id;
}

async function cleanup(runId: string) {
  await db.delete(traceEvents).where(eq(traceEvents.runId, runId));
  await db.delete(runSteps).where(eq(runSteps.runId, runId));
  await db.delete(runs).where(eq(runs.id, runId));
}

describe("逐项处理运行", () => {
  it("每条记录都进入循环，条件可读取当前项并在结束后走退出路径", async () => {
    const runId = await runWith({
      customers: [
        { id: "C-1", priority: "high" },
        { id: "C-2", priority: "normal" },
        { id: "C-3", priority: "high" },
      ],
    });
    try {
      const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
      expect(run?.status).toBe("completed");
      expect(run?.result).toMatchObject({
        loop: { processedCount: 3, sourceCount: 3, limited: false },
      });
      const [loopStep] = await db.select().from(runSteps).where(and(eq(runSteps.runId, runId), eq(runSteps.nodeId, "loop"))).limit(1);
      const [conditionStep] = await db.select().from(runSteps).where(and(eq(runSteps.runId, runId), eq(runSteps.nodeId, "check"))).limit(1);
      const [handleStep] = await db.select().from(runSteps).where(and(eq(runSteps.runId, runId), eq(runSteps.nodeId, "handle"))).limit(1);
      expect(loopStep?.attempt).toBe(3);
      expect(conditionStep?.attempt).toBe(3);
      expect(handleStep?.attempt).toBe(2);
      const traces = await db.select().from(traceEvents).where(eq(traceEvents.runId, runId));
      expect(traces.filter((item) => item.kind === "loop.iteration_started")).toHaveLength(3);
      expect(traces.map((item) => item.kind)).toContain("loop.completed");
    } finally {
      await cleanup(runId);
    }
  }, 240_000);

  it("空集合不执行循环体，直接安全退出", async () => {
    const runId = await runWith({ customers: [] });
    try {
      const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
      expect(run?.status).toBe("completed");
      expect(run?.result).toMatchObject({ loop: { processedCount: 0, sourceCount: 0, limited: false } });
      const [bodyStep] = await db.select().from(runSteps).where(and(eq(runSteps.runId, runId), eq(runSteps.nodeId, "check"))).limit(1);
      expect(bodyStep).toBeUndefined();
    } finally {
      await cleanup(runId);
    }
  }, 240_000);
});
