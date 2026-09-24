import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { start } from "workflow/api";
import { AgentManifest } from "@/contracts/manifest";
import { runSteps, runs, traceEvents } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { agentRunWorkflow } from "@/server/workflows/agent-run";

const AGENT_ID = "00000000-0000-4000-8000-0000000000e3";
const VERSION_ID = "00000000-0000-4000-8000-0000000000e4";

function manifestFor(failurePolicy: "fail_fast" | "continue") {
  return AgentManifest.parse({
    schemaVersion: "4.0",
    workflowFingerprint: "e".repeat(64),
    inputContract: { fields: [] },
    resourceSelection: { model: { modelId: "mock", mock: true } },
    designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
    workflowSnapshot: {
      id: `draft-parallel-${failurePolicy}`,
      startNodeId: "start",
      rootAgent: { id: "agt_parallel_test", name: "并行测试助手", role: "通用业务助手" },
      memoryPolicy: { taskContext: true, longTerm: false },
      nodes: {
        start: { id: "start", title: "收到任务", type: "trigger", next: "parallel" },
        parallel: {
          id: "parallel",
          title: "并行准备材料",
          type: "parallel",
          next: "done",
          parallel: {
            strategy: failurePolicy === "continue" ? "all_settled" : "all",
            failurePolicy,
            branches: [
              {
                id: "content",
                label: "内容材料",
                steps: [{ id: "draft", title: "整理内容", type: "system", description: "内容已整理" }],
              },
              failurePolicy === "continue"
                ? {
                    id: "delivery",
                    label: "发送材料",
                    steps: [{
                      id: "send",
                      title: "发送材料",
                      type: "tool",
                      tool: { connector: "mail", action: "send", scope: "message", protocol: "http", unresolved: true },
                    }],
                  }
                : {
                    id: "risk",
                    label: "风险材料",
                    steps: [{ id: "check", title: "整理风险材料", type: "system", description: "风险已整理" }],
                  },
            ],
          },
        },
        done: { id: "done", title: "流程结束", type: "end", next: null },
      },
    },
  });
}

function manifestForAny() {
  const manifest = manifestFor("continue");
  const parallel = manifest.workflowSnapshot.nodes.parallel;
  if (!parallel.parallel) throw new Error("并行测试配置不完整");
  parallel.parallel.strategy = "any";
  parallel.parallel.failurePolicy = "fail_fast";
  return manifest;
}

async function runWith(manifest: AgentManifest) {
  const [row] = await db.insert(runs).values({
    workspaceId: DEMO_WORKSPACE_ID,
    createdBy: DEMO_USER_ID,
    agentId: AGENT_ID,
    versionId: VERSION_ID,
    status: "queued",
    input: { topic: "季度复盘" },
  }).returning({ id: runs.id });
  const handle = await start(agentRunWorkflow, [row.id, manifest, { topic: "季度复盘" }]);
  await handle.returnValue;
  return row.id;
}

async function cleanup(runId: string) {
  await db.delete(traceEvents).where(eq(traceEvents.runId, runId));
  await db.delete(runSteps).where(eq(runSteps.runId, runId));
  await db.delete(runs).where(eq(runs.id, runId));
}

describe("并行分支运行", () => {
  it("同时完成所有分支并汇总各自输出", async () => {
    const runId = await runWith(manifestFor("fail_fast"));
    try {
      const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
      expect(run?.status).toBe("completed");
      expect(run?.result).toMatchObject({
        parallel: {
          status: "completed",
          completedCount: 2,
          failedCount: 0,
          branches: {
            content: { status: "completed" },
            risk: { status: "completed" },
          },
        },
      });
      const steps = await db.select().from(runSteps).where(eq(runSteps.runId, runId));
      expect(steps.map((step) => step.nodeId)).toEqual(expect.arrayContaining([
        "parallel",
        "parallel.content.draft",
        "parallel.risk.check",
      ]));
      const traces = await db.select().from(traceEvents).where(eq(traceEvents.runId, runId));
      expect(traces.map((trace) => trace.kind)).toEqual(expect.arrayContaining(["parallel.started", "parallel.completed"]));
    } finally {
      await cleanup(runId);
    }
  }, 240_000);

  it("允许保留单个分支的问题并继续完成主流程", async () => {
    const runId = await runWith(manifestFor("continue"));
    try {
      const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
      expect(run?.status).toBe("completed");
      expect(run?.result).toMatchObject({
        parallel: {
          status: "completed_with_issues",
          completedCount: 1,
          failedCount: 1,
          branches: {
            content: { status: "completed" },
            delivery: { status: "failed", error: expect.stringContaining("工具未绑定") },
          },
        },
      });
      const [parallelStep] = await db.select().from(runSteps).where(and(
        eq(runSteps.runId, runId),
        eq(runSteps.nodeId, "parallel"),
      )).limit(1);
      expect(parallelStep?.status).toBe("succeeded");
      const traces = await db.select().from(traceEvents).where(eq(traceEvents.runId, runId));
      expect(traces.map((trace) => trace.kind)).toContain("parallel.completed_with_issues");
    } finally {
      await cleanup(runId);
    }
  }, 240_000);

  it("任一分支成功时完成并记录采用的分支", async () => {
    const runId = await runWith(manifestForAny());
    try {
      const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
      expect(run?.status).toBe("completed");
      expect(run?.result).toMatchObject({
        parallel: {
          strategy: "any",
          status: "completed",
          selectedBranchId: "content",
          completedCount: 1,
          failedCount: 1,
        },
      });
      const [parallelStep] = await db.select().from(runSteps).where(and(
        eq(runSteps.runId, runId),
        eq(runSteps.nodeId, "parallel"),
      )).limit(1);
      expect(parallelStep?.status).toBe("succeeded");
    } finally {
      await cleanup(runId);
    }
  }, 240_000);
});
