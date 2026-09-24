import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { start } from "workflow/api";
import { AgentManifest } from "@/contracts/manifest";
import { agents, agentVersions, runSteps, runs, traceEvents } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { agentRunWorkflow } from "@/server/workflows/agent-run";

const PARENT_AGENT_ID = "00000000-0000-4000-8000-0000000006a1";
const PARENT_VERSION_ID = "00000000-0000-4000-8000-0000000006a2";
const TARGET_AGENT_ID = "00000000-0000-4000-8000-0000000006a3";
const TARGET_VERSION_ID = "00000000-0000-4000-8000-0000000006a4";

const targetManifest = AgentManifest.parse({
  schemaVersion: "4.0",
  workflowFingerprint: "a".repeat(64),
  inputContract: { fields: [{ name: "brief", required: true }] },
  resourceSelection: { model: { modelId: "mock", mock: true } },
  designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
  workflowSnapshot: {
    id: "agent-call-target",
    startNodeId: "start",
    rootAgent: { id: TARGET_AGENT_ID, name: "研究助手", role: "研究" },
    memoryPolicy: { taskContext: true, longTerm: false },
    nodes: {
      start: { id: "start", title: "收到任务", type: "trigger", next: "done" },
      done: { id: "done", title: "完成研究", type: "end", next: null },
    },
  },
});

const parentManifest = AgentManifest.parse({
  schemaVersion: "4.0",
  workflowFingerprint: "b".repeat(64),
  inputContract: { fields: [{ name: "topic", required: true }] },
  resourceSelection: { model: { modelId: "mock", mock: true } },
  designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
  workflowSnapshot: {
    id: "agent-call-parent",
    startNodeId: "start",
    rootAgent: { id: PARENT_AGENT_ID, name: "主助手", role: "统筹" },
    memoryPolicy: { taskContext: true, longTerm: false },
    nodes: {
      start: { id: "start", title: "收到任务", type: "trigger", next: "research" },
      research: {
        id: "research",
        title: "请研究助手分析",
        type: "agent_call",
        next: "done",
        agentCall: { targetAgentId: TARGET_AGENT_ID, versionId: TARGET_VERSION_ID },
      },
      done: { id: "done", title: "完成任务", type: "end", next: null },
    },
  },
});

async function cleanup(parentRunId?: string) {
  const childRows = parentRunId
    ? await db.select({ id: runs.id }).from(runs).where(eq(runs.sourceKey, `agent-call:${parentRunId}:research`))
    : [];
  const runIds = [...childRows.map((row) => row.id), ...(parentRunId ? [parentRunId] : [])];
  if (runIds.length > 0) {
    await db.delete(traceEvents).where(inArray(traceEvents.runId, runIds));
    await db.delete(runSteps).where(inArray(runSteps.runId, runIds));
    await db.delete(runs).where(inArray(runs.id, runIds));
  }
  await db.delete(agentVersions).where(eq(agentVersions.id, TARGET_VERSION_ID));
  await db.delete(agents).where(eq(agents.id, TARGET_AGENT_ID));
}

describe("助手协作运行", () => {
  it("冻结目标版本、创建独立子运行并把结果带回主流程", async () => {
    let parentRunId: string | undefined;
    await cleanup();
    try {
      await db.insert(agents).values({
        id: TARGET_AGENT_ID,
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        name: "研究助手",
        intentText: "完成研究",
        status: "published",
      });
      await db.insert(agentVersions).values({
        id: TARGET_VERSION_ID,
        agentId: TARGET_AGENT_ID,
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        version: 1,
        status: "production",
        manifest: targetManifest,
      });
      const [parent] = await db.insert(runs).values({
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        agentId: PARENT_AGENT_ID,
        versionId: PARENT_VERSION_ID,
        status: "queued",
        input: { topic: "客户留存" },
      }).returning({ id: runs.id });
      parentRunId = parent.id;

      const handle = await start(agentRunWorkflow, [parent.id, parentManifest, { topic: "客户留存" }]);
      await handle.returnValue;

      const [finishedParent] = await db.select().from(runs).where(eq(runs.id, parent.id)).limit(1);
      const [child] = await db.select().from(runs).where(eq(runs.sourceKey, `agent-call:${parent.id}:research`)).limit(1);
      expect(finishedParent?.status).toBe("completed");
      expect(finishedParent?.result).toMatchObject({
        research: { assistant: "研究助手", status: "completed", result: {} },
      });
      expect(child).toMatchObject({
        agentId: TARGET_AGENT_ID,
        versionId: TARGET_VERSION_ID,
        sourceType: "agent_call",
        status: "completed",
      });
      expect(child?.input).toMatchObject({ brief: expect.stringContaining("客户留存") });
    } finally {
      await cleanup(parentRunId);
    }
  }, 240_000);
});
