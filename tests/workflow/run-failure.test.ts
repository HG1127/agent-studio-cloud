import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { start } from "workflow/api";
import { WorkflowRunFailedError } from "workflow/errors";
import { AgentManifest } from "@/contracts/manifest";
import { agentRunWorkflow } from "@/server/workflows/agent-run";
import { runs, traceEvents } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";

// M1 终审 Major-1：编排循环失败兜底——任一步骤抛错时 runs 表必须写入失败终态，SDK 侧 run 同步失败

const AGENT_ID = "00000000-0000-4000-8000-0000000000d1";
const VERSION_ID = "00000000-0000-4000-8000-0000000000d2";

// 手工构造、未经 startRunAction 校验的 manifest：含一个契约与编排器都不支持的节点类型
// （不通过 AgentManifest.parse，模拟畸形 manifest 直达执行引擎）
const badManifest = {
  schemaVersion: "4.0",
  workflowFingerprint: "d".repeat(64),
  inputContract: { fields: [] },
  resourceSelection: { model: { modelId: "mock", mock: true } },
  designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
  workflowSnapshot: {
    id: "draft-failure-test",
    startNodeId: "start",
    rootAgent: { id: "agt_failure_test", name: "失败兜底演示助手", role: "通用业务助手" },
    memoryPolicy: { taskContext: true, longTerm: false },
    nodes: {
      start: { id: "start", title: "收到任务", type: "trigger", next: "boom", requirementIds: [] },
      boom: { id: "boom", title: "编排器不支持的步骤", type: "teleport", next: "done", requirementIds: [] },
      done: { id: "done", title: "流程结束", type: "end", next: null, requirementIds: [] },
    },
  },
} as unknown as AgentManifest;

const fallbackManifest = AgentManifest.parse({
  schemaVersion: "4.0",
  workflowFingerprint: "f".repeat(64),
  inputContract: { fields: [] },
  resourceSelection: { model: { modelId: "mock", mock: true } },
  designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
  workflowSnapshot: {
    id: "draft-failure-fallback",
    startNodeId: "start",
    rootAgent: { id: "agt_failure_test", name: "失败分支测试助手", role: "通用业务助手" },
    memoryPolicy: { taskContext: true, longTerm: false },
    nodes: {
      start: { id: "start", title: "收到任务", type: "trigger", next: "broken_tool" },
      broken_tool: {
        id: "broken_tool",
        title: "调用不可用系统",
        type: "tool",
        next: "done",
        onErrorNext: "fallback",
        tool: {
          connector: "external",
          action: "send",
          scope: "当前工作区",
          risk: "low",
          maxRetries: 1,
          registryToolId: "external-send",
          protocol: "external",
          inputSchema: { type: "object" },
          outputSchema: { type: "object" },
        },
      },
      fallback: { id: "fallback", title: "转人工记录", type: "system", next: "done", system: { kind: "record" } },
      done: { id: "done", title: "流程结束", type: "end", next: null },
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

describe("运行失败兜底", () => {
  it("业务操作失败时按未完成路径继续并保留失败原因", async () => {
    const runId = await insertRun();
    const handle = await start(agentRunWorkflow, [runId, fallbackManifest, {}]);

    await expect(handle.returnValue).resolves.toEqual({ status: "completed" });
    const [runAfter] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
    expect(runAfter).toMatchObject({
      status: "completed",
      result: { broken_tool: { status: "failed", error: expect.stringContaining("暂不支持") } },
    });
    const handled = await db.select().from(traceEvents).where(eq(traceEvents.runId, runId));
    expect(handled.some((event) => event.kind === "step.failed_handled" && event.nodeId === "broken_tool")).toBe(true);
  }, 240_000);

  it("步骤抛错时 runs 写入失败终态与中文原因，SDK 侧 run 同步失败", async () => {
    const runId = await insertRun();
    const handle = await start(agentRunWorkflow, [runId, badManifest, {}]);

    let rejected: unknown;
    try {
      await handle.returnValue;
      expect.unreachable("workflow 应以失败结束");
    } catch (err) {
      rejected = err;
    }
    expect(WorkflowRunFailedError.is(rejected)).toBe(true);

    // dev 重放有延迟：轮询等待兜底 failRun 落库
    let runAfter: typeof runs.$inferSelect | undefined;
    for (let i = 0; i < 30; i += 1) {
      [runAfter] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
      if (runAfter?.status === "failed") break;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    expect(runAfter?.status).toBe("failed");
    expect(runAfter?.error).toBe("步骤「编排器不支持的步骤」暂不支持自动执行");
    expect(runAfter?.finishedAt).not.toBeNull();
  }, 240_000);
});
