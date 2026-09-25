import { eq, inArray, like, or } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { start } from "workflow/api";
import { AgentManifest } from "@/contracts/manifest";
import { agents, agentVersions, runSteps, runs, traceEvents } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { agentRunWorkflow } from "@/server/workflows/agent-run";
import { listChildRuns } from "@/server/queries/runs";
import { beginAgentCall } from "@/server/steps/agent-call-step";

const PARENT_AGENT_ID = "00000000-0000-4000-8000-0000000006a1";
const PARENT_VERSION_ID = "00000000-0000-4000-8000-0000000006a2";
const TARGET_AGENT_ID = "00000000-0000-4000-8000-0000000006a3";
const TARGET_VERSION_ID = "00000000-0000-4000-8000-0000000006a4";
const CYCLE_ROOT_RUN_ID = "00000000-0000-4000-8000-0000000006a5";
const CYCLE_CHILD_RUN_ID = "00000000-0000-4000-8000-0000000006a6";

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

const handoffManifest = AgentManifest.parse({
  schemaVersion: "4.0",
  workflowFingerprint: "d".repeat(64),
  inputContract: { fields: [{ name: "topic", required: true }] },
  resourceSelection: { model: { modelId: "mock", mock: true } },
  designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
  workflowSnapshot: {
    id: "handoff-parent",
    startNodeId: "start",
    rootAgent: { id: PARENT_AGENT_ID, name: "主助手", role: "统筹" },
    memoryPolicy: { taskContext: true, longTerm: false },
    nodes: {
      start: { id: "start", title: "收到任务", type: "trigger", next: "handoff" },
      handoff: {
        id: "handoff",
        title: "交给研究助手",
        type: "handoff",
        next: "done",
        toAgent: { id: TARGET_AGENT_ID, name: "研究助手", versionId: TARGET_VERSION_ID },
        contract: {
          deliverables: ["研究结果"],
          mustNotInclude: ["密钥和访问令牌"],
          inputSchema: [{ name: "brief", type: "string" }],
          outputSchema: [{ name: "result", type: "any", required: false }],
          memoryPolicy: { mode: "none", shared: [], private: ["密钥"] },
        },
      },
      done: { id: "done", title: "完成任务", type: "end", next: null },
    },
  },
});

const loopCallManifest = AgentManifest.parse({
  ...parentManifest,
  workflowFingerprint: "c".repeat(64),
  workflowSnapshot: {
    ...parentManifest.workflowSnapshot,
    id: "agent-call-loop-parent",
    nodes: {
      start: { id: "start", title: "收到任务", type: "trigger", next: "each_item" },
      each_item: {
        id: "each_item",
        title: "逐项处理",
        type: "loop",
        next: null,
        loop: { collectionPath: "input.items", itemKey: "item", maxIterations: 10, bodyNext: "research", exitNext: "done" },
      },
      research: {
        ...parentManifest.workflowSnapshot.nodes.research,
        next: "each_item",
      },
      done: { id: "done", title: "完成任务", type: "end", next: null },
    },
  },
});

async function insertTarget() {
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
}

async function cleanup(parentRunId?: string) {
  const childRows = parentRunId
    ? await db.select({ id: runs.id }).from(runs).where(or(
        like(runs.sourceKey, `agent-call:${parentRunId}:%`),
        like(runs.sourceKey, `handoff:${parentRunId}:%`),
      ))
    : [];
  const runIds = [
    ...childRows.map((row) => row.id),
    ...(parentRunId ? [parentRunId] : []),
    CYCLE_CHILD_RUN_ID,
    CYCLE_ROOT_RUN_ID,
  ];
  if (runIds.length > 0) {
    await db.delete(traceEvents).where(inArray(traceEvents.runId, runIds));
    await db.delete(runSteps).where(inArray(runSteps.runId, runIds));
    await db.delete(runs).where(inArray(runs.id, runIds));
  }
  await db.delete(agentVersions).where(eq(agentVersions.id, TARGET_VERSION_ID));
  await db.delete(agents).where(eq(agents.id, TARGET_AGENT_ID));
}

describe("助手协作运行", () => {
  it("拒绝创建会回到祖先助手的循环调用", async () => {
    await cleanup();
    try {
      await db.insert(runs).values([
        {
          id: CYCLE_ROOT_RUN_ID,
          workspaceId: DEMO_WORKSPACE_ID,
          createdBy: DEMO_USER_ID,
          agentId: TARGET_AGENT_ID,
          versionId: TARGET_VERSION_ID,
          status: "running",
          input: {},
        },
        {
          id: CYCLE_CHILD_RUN_ID,
          workspaceId: DEMO_WORKSPACE_ID,
          createdBy: DEMO_USER_ID,
          agentId: PARENT_AGENT_ID,
          versionId: PARENT_VERSION_ID,
          status: "running",
          input: {},
          sourceType: "agent_call",
          sourceKey: `agent-call:${CYCLE_ROOT_RUN_ID}:delegate`,
        },
      ]);

      await expect(beginAgentCall({
        runId: CYCLE_CHILD_RUN_ID,
        node: parentManifest.workflowSnapshot.nodes.research,
        parentInput: {},
        outputs: {},
      })).rejects.toThrow("循环");
      expect(await db.select().from(runs).where(eq(runs.sourceKey, `agent-call:${CYCLE_CHILD_RUN_ID}:research`)))
        .toHaveLength(0);
    } finally {
      await cleanup();
    }
  });

  it("冻结目标版本、创建独立子运行并把结果带回主流程", async () => {
    let parentRunId: string | undefined;
    await cleanup();
    try {
      await insertTarget();
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
      const [child] = await db.select().from(runs).where(like(runs.sourceKey, `agent-call:${parent.id}:research:%`)).limit(1);
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
      expect(await listChildRuns(parent.id, DEMO_WORKSPACE_ID)).toEqual([
        expect.objectContaining({ id: child?.id, sourceType: "agent_call", agentName: "研究助手" }),
      ]);
    } finally {
      await cleanup(parentRunId);
    }
  }, 240_000);

  it("循环中的同一协作节点为每一轮创建独立子运行", async () => {
    let parentRunId: string | undefined;
    await cleanup();
    try {
      await insertTarget();
      const [parent] = await db.insert(runs).values({
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        agentId: PARENT_AGENT_ID,
        versionId: PARENT_VERSION_ID,
        status: "queued",
        input: { topic: "分项研究", items: ["第一项", "第二项"] },
      }).returning({ id: runs.id });
      parentRunId = parent.id;

      const handle = await start(agentRunWorkflow, [parent.id, loopCallManifest, { topic: "分项研究", items: ["第一项", "第二项"] }]);
      await expect(handle.returnValue).resolves.toEqual({ status: "completed" });

      const children = await db.select().from(runs).where(like(runs.sourceKey, `agent-call:${parent.id}:research:%`));
      expect(children).toHaveLength(2);
      expect(new Set(children.map((child) => child.sourceKey)).size).toBe(2);
      expect(children.every((child) => child.status === "completed")).toBe(true);
    } finally {
      await cleanup(parentRunId);
    }
  }, 240_000);

  it("按交接契约创建独立子运行并返回交付物", async () => {
    let parentRunId: string | undefined;
    await cleanup();
    try {
      await insertTarget();
      const [parent] = await db.insert(runs).values({
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        agentId: PARENT_AGENT_ID,
        versionId: PARENT_VERSION_ID,
        status: "queued",
        input: { topic: "客户续约", apiKey: "not-shared" },
      }).returning({ id: runs.id });
      parentRunId = parent.id;

      const handle = await start(agentRunWorkflow, [parent.id, handoffManifest, { topic: "客户续约", apiKey: "not-shared" }]);
      await handle.returnValue;

      const [finishedParent] = await db.select().from(runs).where(eq(runs.id, parent.id)).limit(1);
      const [child] = await db.select().from(runs).where(like(runs.sourceKey, `handoff:${parent.id}:handoff:%`)).limit(1);
      expect(finishedParent?.status).toBe("completed");
      expect(finishedParent?.result).toMatchObject({
        handoff: { assistant: "研究助手", status: "completed", deliverables: ["研究结果"], result: {} },
      });
      expect(child).toMatchObject({
        agentId: TARGET_AGENT_ID,
        versionId: TARGET_VERSION_ID,
        sourceType: "handoff",
        status: "completed",
      });
      expect(JSON.stringify(child?.input)).not.toContain("not-shared");
      expect(await listChildRuns(parent.id, DEMO_WORKSPACE_ID)).toEqual([
        expect.objectContaining({ id: child?.id, sourceType: "handoff", agentName: "研究助手" }),
      ]);
    } finally {
      await cleanup(parentRunId);
    }
  }, 240_000);

  it("接收助手缺少约定交付字段时进入备用路径", async () => {
    let parentRunId: string | undefined;
    await cleanup();
    try {
      await insertTarget();
      const guardedManifest = AgentManifest.parse({
        ...handoffManifest,
        workflowSnapshot: {
          ...handoffManifest.workflowSnapshot,
          nodes: {
            ...handoffManifest.workflowSnapshot.nodes,
            handoff: {
              ...handoffManifest.workflowSnapshot.nodes.handoff,
              onErrorNext: "fallback",
              contract: {
                ...handoffManifest.workflowSnapshot.nodes.handoff.contract!,
                outputSchema: [{ name: "result", label: "研究结果", type: "any", required: true }],
              },
            },
            fallback: { id: "fallback", title: "转员工补充结果", type: "system", next: "done" },
          },
        },
      });
      const [parent] = await db.insert(runs).values({
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        agentId: PARENT_AGENT_ID,
        versionId: PARENT_VERSION_ID,
        status: "queued",
        input: { topic: "客户续约" },
      }).returning({ id: runs.id });
      parentRunId = parent.id;

      const handle = await start(agentRunWorkflow, [parent.id, guardedManifest, { topic: "客户续约" }]);
      await expect(handle.returnValue).resolves.toEqual({ status: "completed" });

      const [finishedParent] = await db.select().from(runs).where(eq(runs.id, parent.id)).limit(1);
      expect(finishedParent?.result).toMatchObject({
        handoff: { status: "failed", error: expect.stringContaining("缺少“研究结果”") },
        fallback: { summary: "转员工补充结果已完成" },
      });
    } finally {
      await cleanup(parentRunId);
    }
  }, 240_000);

  it("协作或交接输入无法满足目标契约时进入备用路径", async () => {
    const parentRunIds: string[] = [];
    await cleanup();
    try {
      await insertTarget();
      const strictTarget = AgentManifest.parse({
        ...targetManifest,
        inputContract: { fields: [{ name: "count", type: "number", required: true }] },
      });
      await db.update(agentVersions).set({ manifest: strictTarget }).where(eq(agentVersions.id, TARGET_VERSION_ID));
      const manifests = [
        AgentManifest.parse({
          ...parentManifest,
          workflowSnapshot: {
            ...parentManifest.workflowSnapshot,
            nodes: {
              ...parentManifest.workflowSnapshot.nodes,
              research: { ...parentManifest.workflowSnapshot.nodes.research, onErrorNext: "fallback" },
              fallback: { id: "fallback", title: "转员工补充协作输入", type: "system", next: "done" },
            },
          },
        }),
        AgentManifest.parse({
          ...handoffManifest,
          workflowSnapshot: {
            ...handoffManifest.workflowSnapshot,
            nodes: {
              ...handoffManifest.workflowSnapshot.nodes,
              handoff: { ...handoffManifest.workflowSnapshot.nodes.handoff, onErrorNext: "fallback" },
              fallback: { id: "fallback", title: "转员工补充交接输入", type: "system", next: "done" },
            },
          },
        }),
      ];

      for (const [index, preparedManifest] of manifests.entries()) {
        const [parent] = await db.insert(runs).values({
          workspaceId: DEMO_WORKSPACE_ID,
          createdBy: DEMO_USER_ID,
          agentId: PARENT_AGENT_ID,
          versionId: PARENT_VERSION_ID,
          status: "queued",
          input: { topic: "缺少数量" },
        }).returning({ id: runs.id });
        parentRunIds.push(parent.id);
        const handle = await start(agentRunWorkflow, [parent.id, preparedManifest, { topic: "缺少数量" }]);
        await expect(handle.returnValue).resolves.toEqual({ status: "completed" });
        const [finished] = await db.select().from(runs).where(eq(runs.id, parent.id)).limit(1);
        const nodeId = index === 0 ? "research" : "handoff";
        expect(finished?.result).toMatchObject({
          [nodeId]: { status: "failed", error: expect.stringContaining("输入") },
          fallback: { summary: expect.stringContaining("补充") },
        });
        expect(await db.select().from(runs).where(or(
          like(runs.sourceKey, `agent-call:${parent.id}:%`),
          like(runs.sourceKey, `handoff:${parent.id}:%`),
        ))).toHaveLength(0);
      }
    } finally {
      for (const parentRunId of parentRunIds) await cleanup(parentRunId);
      if (parentRunIds.length === 0) await cleanup();
    }
  }, 240_000);
});
