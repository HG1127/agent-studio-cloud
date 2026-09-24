import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { start } from "workflow/api";
import { AgentManifest } from "@/contracts/manifest";
import { runSteps, runs, traceEvents } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { agentRunWorkflow } from "@/server/workflows/agent-run";

const AGENT_ID = "00000000-0000-4000-8000-0000000000f3";
const VERSION_ID = "00000000-0000-4000-8000-0000000000f4";

const manifest = AgentManifest.parse({
  schemaVersion: "4.0",
  workflowFingerprint: "f".repeat(64),
  inputContract: { fields: [] },
  resourceSelection: { model: { modelId: "mock", mock: true } },
  designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
  workflowSnapshot: {
    id: "draft-subflow-runtime-test",
    startNodeId: "start",
    rootAgent: { id: "agt_subflow_test", name: "子流程测试助手", role: "通用业务助手" },
    memoryPolicy: { taskContext: true, longTerm: false },
    nodes: {
      start: { id: "start", title: "收到任务", type: "trigger", next: "research" },
      research: {
        id: "research",
        title: "完成专题研究",
        type: "subflow",
        next: "done",
        subflow: {
          name: "专题研究",
          inputs: ["研究主题"],
          outputs: ["研究结论"],
          failurePolicy: "checkpoint",
          steps: [
            { id: "collect", title: "整理材料", type: "system", description: "材料已整理" },
            { id: "conclude", title: "形成结论", type: "system", description: "结论已形成" },
          ],
        },
      },
      done: { id: "done", title: "流程结束", type: "end", next: null },
    },
  },
});

async function cleanup(runId: string) {
  await db.delete(traceEvents).where(eq(traceEvents.runId, runId));
  await db.delete(runSteps).where(eq(runSteps.runId, runId));
  await db.delete(runs).where(eq(runs.id, runId));
}

describe("一组步骤运行", () => {
  it("按顺序完成子步骤并向主流程返回汇总结果", async () => {
    const [row] = await db.insert(runs).values({
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      agentId: AGENT_ID,
      versionId: VERSION_ID,
      status: "queued",
      input: { topic: "客户留存" },
    }).returning({ id: runs.id });
    try {
      const handle = await start(agentRunWorkflow, [row.id, manifest, { topic: "客户留存" }]);
      await handle.returnValue;
      const [run] = await db.select().from(runs).where(eq(runs.id, row.id)).limit(1);
      expect(run?.status).toBe("completed");
      expect(run?.result).toMatchObject({
        research: {
          name: "专题研究",
          status: "completed",
          expectedOutputs: ["研究结论"],
          steps: [
            { title: "整理材料", output: { summary: "材料已整理" } },
            { title: "形成结论", output: { summary: "结论已形成" } },
          ],
        },
      });
      const steps = await db.select().from(runSteps).where(eq(runSteps.runId, row.id));
      expect(steps.map((step) => step.nodeId)).toEqual(expect.arrayContaining([
        "research",
        "research.collect",
        "research.conclude",
      ]));
      const traces = await db.select().from(traceEvents).where(eq(traceEvents.runId, row.id));
      expect(traces.map((trace) => trace.kind)).toEqual(expect.arrayContaining(["subflow.started", "subflow.completed"]));
    } finally {
      await cleanup(row.id);
    }
  }, 240_000);
});
