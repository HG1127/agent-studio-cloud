import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { resumeHook, start } from "workflow/api";
import { waitForHook } from "@workflow/vitest";
import { AgentManifest } from "@/contracts/manifest";
import { runSteps, runs, traceEvents } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { agentRunWorkflow } from "@/server/workflows/agent-run";
import { getPendingWaitHook } from "@/server/queries/runs";

const AGENT_ID = "00000000-0000-4000-8000-0000000000b1";
const VERSION_ID = "00000000-0000-4000-8000-0000000000b2";

function manifestFor(wait: Record<string, unknown>, next = "done") {
  return AgentManifest.parse({
    schemaVersion: "4.0",
    workflowFingerprint: "b".repeat(64),
    inputContract: { fields: [] },
    resourceSelection: { model: { modelId: "mock", mock: true } },
    designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
    workflowSnapshot: {
      id: "draft-wait-test",
      startNodeId: "start",
      rootAgent: { id: "agt_wait_test", name: "等待测试助手", role: "通用业务助手" },
      memoryPolicy: { taskContext: true, longTerm: false },
      nodes: {
        start: { id: "start", title: "收到任务", type: "trigger", next: "wait", requirementIds: [] },
        wait: { id: "wait", title: "等待客户补充资料", type: "wait", next, wait, requirementIds: [] },
        done: { id: "done", title: "流程结束", type: "end", next: null, requirementIds: [] },
        timeout: { id: "timeout", title: "等待超时后结束", type: "end", next: null, requirementIds: [] },
      },
    },
  });
}

async function insertRun() {
  const [row] = await db.insert(runs).values({
    workspaceId: DEMO_WORKSPACE_ID,
    createdBy: DEMO_USER_ID,
    agentId: AGENT_ID,
    versionId: VERSION_ID,
    status: "queued",
    input: {},
  }).returning({ id: runs.id });
  return row.id;
}

async function cleanup(runId: string) {
  await db.delete(traceEvents).where(eq(traceEvents.runId, runId));
  await db.delete(runSteps).where(eq(runSteps.runId, runId));
  await db.delete(runs).where(eq(runs.id, runId));
}

async function waitForCurrentWaitHook(
  handle: Parameters<typeof waitForHook>[0],
  runId: string,
  excludeToken?: string,
): Promise<string> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const pending = await getPendingWaitHook(runId, DEMO_WORKSPACE_ID);
    if (pending && pending.hookToken !== excludeToken) {
      await waitForHook(handle, { token: pending.hookToken, timeout: Math.max(1, deadline - Date.now()) });
      return pending.hookToken;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("等待外部消息 Hook 超时");
}

describe("等待节点暂停与恢复", () => {
  it("等待外部消息时暂停，收到匹配消息后保存载荷并继续", async () => {
    const runId = await insertRun();
    const manifest = manifestFor({
      mode: "event",
      durationMs: 0,
      until: null,
      eventKey: "customer.profile.updated",
      eventLabel: "客户已补充资料",
      payloadSchema: { type: "object" },
      timeoutMs: 0,
      onTimeoutNext: null,
    });
    try {
      const handle = await start(agentRunWorkflow, [runId, manifest, {}]);
      const token = await waitForCurrentWaitHook(handle, runId);

      const [waiting] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
      expect(waiting?.status).toBe("waiting_event");

      await resumeHook(token, { customerId: "C-100", complete: true });
      expect(await handle.returnValue).toEqual({ status: "completed" });

      const [completed] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
      expect(completed?.status).toBe("completed");
      expect(completed?.result).toMatchObject({
        wait: {
          resumedBy: "event",
          eventKey: "customer.profile.updated",
          payload: { customerId: "C-100", complete: true },
        },
      });
      const traces = await db.select().from(traceEvents).where(eq(traceEvents.runId, runId));
      expect(traces.map((item) => item.kind)).toEqual(expect.arrayContaining(["wait.started", "wait.resumed", "run.completed"]));
    } finally {
      await cleanup(runId);
    }
  }, 240_000);

  it("等待外部消息超时后走明确的超时分支", async () => {
    const runId = await insertRun();
    const manifest = manifestFor({
      mode: "event",
      durationMs: 0,
      until: null,
      eventKey: "customer.profile.updated",
      payloadSchema: { type: "object" },
      timeoutMs: 10,
      onTimeoutNext: "timeout",
    });
    try {
      const handle = await start(agentRunWorkflow, [runId, manifest, {}]);
      expect(await handle.returnValue).toEqual({ status: "completed" });
      const [completed] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
      expect(completed?.result).toMatchObject({ wait: { timedOut: true, timeoutMs: 10 } });
      const traces = await db.select().from(traceEvents).where(eq(traceEvents.runId, runId));
      expect(traces.map((item) => item.kind)).toContain("wait.timed_out");
    } finally {
      await cleanup(runId);
    }
  }, 240_000);

  it("循环中的同一等待节点每一轮使用不同 Hook", async () => {
    const runId = await insertRun();
    const loopManifest = AgentManifest.parse({
      ...manifestFor({ mode: "event", durationMs: 0, until: null, eventKey: "item.ready", payloadSchema: { type: "object" }, timeoutMs: 0, onTimeoutNext: null }),
      workflowFingerprint: "c".repeat(64),
      workflowSnapshot: {
        ...manifestFor({ mode: "event", durationMs: 0, until: null, eventKey: "item.ready", payloadSchema: { type: "object" }, timeoutMs: 0, onTimeoutNext: null }).workflowSnapshot,
        id: "draft-wait-loop-test",
        nodes: {
          start: { id: "start", title: "收到任务", type: "trigger", next: "each_item" },
          each_item: {
            id: "each_item",
            title: "逐项等待",
            type: "loop",
            next: null,
            loop: { collectionPath: "input.items", itemKey: "item", maxIterations: 10, bodyNext: "wait", exitNext: "done" },
          },
          wait: {
            id: "wait",
            title: "等待当前项消息",
            type: "wait",
            next: "each_item",
            wait: { mode: "event", durationMs: 0, until: null, eventKey: "item.ready", payloadSchema: { type: "object" }, timeoutMs: 0, onTimeoutNext: null },
          },
          done: { id: "done", title: "流程结束", type: "end", next: null },
        },
      },
    });
    try {
      const handle = await start(agentRunWorkflow, [runId, loopManifest, { items: ["第一项", "第二项"] }]);
      const firstToken = await waitForCurrentWaitHook(handle, runId);
      await resumeHook(firstToken, { item: "第一项" });
      const secondToken = await waitForCurrentWaitHook(handle, runId, firstToken);
      expect(secondToken).not.toBe(firstToken);
      await resumeHook(secondToken, { item: "第二项" });
      await expect(handle.returnValue).resolves.toEqual({ status: "completed" });
    } finally {
      await cleanup(runId);
    }
  }, 240_000);
});
