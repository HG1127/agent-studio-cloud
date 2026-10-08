import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { start } from "workflow/api";
import { AgentManifest } from "@/contracts/manifest";
import { knowledgeChunks, knowledgeSources, modelCalls, runSteps, runs, traceEvents } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { agentRunWorkflow } from "@/server/workflows/agent-run";
import { getRunModelUsage } from "@/server/queries/model-usage";
import { startModelJsonServer } from "../helpers/model-json-server";

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

async function runWith(input: Record<string, unknown>, workflowManifest = manifest) {
  const [row] = await db.insert(runs).values({
    workspaceId: DEMO_WORKSPACE_ID,
    createdBy: DEMO_USER_ID,
    agentId: AGENT_ID,
    versionId: VERSION_ID,
    status: "queued",
    input,
  }).returning({ id: runs.id });
  const handle = await start(agentRunWorkflow, [row.id, workflowManifest, input]);
  await handle.returnValue;
  return row.id;
}

async function cleanup(runId: string) {
  await db.delete(traceEvents).where(eq(traceEvents.runId, runId));
  await db.delete(runSteps).where(eq(runSteps.runId, runId));
  await db.delete(runs).where(eq(runs.id, runId));
}

describe("逐项处理运行", () => {
  it("真实模型重复执行同一节点逐次入账，不把最后一次步骤回执冒充整个循环用量", async () => {
    const service = await startModelJsonServer(["第一位客户处理完成", "第三位客户处理完成"]);
    const runId = crypto.randomUUID();
    try {
      vi.stubEnv("MODEL_BASE_URL", service.baseUrl + "/v1"); vi.stubEnv("MODEL_API_KEY", "test-loop-only-key");
      vi.stubEnv("MODEL_ID", "test-model"); vi.stubEnv("REAL_MODELS_ENABLED", "1");
      const actual = AgentManifest.parse({ ...manifest, resourceSelection: { model: { modelId: "test-model", mock: false } } });
      const input = { customers: [{ id: "C-1", priority: "high" }, { id: "C-2", priority: "normal" }, { id: "C-3", priority: "high" }] };
      await db.insert(runs).values({ id: runId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, agentId: AGENT_ID, versionId: VERSION_ID, status: "queued", input });
      const handle = await start(agentRunWorkflow, [runId, actual, input]); await expect(handle.returnValue).resolves.toEqual({ status: "completed" });
      expect(service.modelRequests).toHaveLength(2);
      const calls = await db.select().from(modelCalls).where(eq(modelCalls.runId, runId));
      expect(calls).toHaveLength(2); expect(new Set(calls.map((call) => call.id)).size).toBe(2); expect(calls.every((call) => call.nodeId === "handle")).toBe(true);
      const [latest] = await db.select().from(runSteps).where(and(eq(runSteps.runId, runId), eq(runSteps.nodeId, "handle")));
      expect(latest).toMatchObject({ attempt: 2, output: { usage: { inputTokens: 12, outputTokens: 6 } } });
      expect(await getRunModelUsage(DEMO_WORKSPACE_ID, runId)).toMatchObject({ tracking: "tracked-v1", calls: { total: 2, returned: 2 }, usage: { knownInputTokens: 24, knownOutputTokens: 12, knownCallTotalTokens: 36, recordedUsageComplete: true } });
    } finally { await service.close(); vi.unstubAllEnvs(); await cleanup(runId); }
  }, 240_000);

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
        loop: {
          processedCount: 3,
          sourceCount: 3,
          limited: false,
          iterations: [
            { iteration: 1, bodyOutput: expect.stringContaining("处理高优先级客户") },
            { iteration: 2, bodyOutput: { matched: "默认分支", next: "loop" } },
            { iteration: 3, bodyOutput: expect.stringContaining("处理高优先级客户") },
          ],
        },
        check: { matched: "高优先级", next: "handle" },
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

  it("上一项的产出不能让下一项跳过的交付检查误判通过", async () => {
    const isolatedManifest = AgentManifest.parse({
      ...manifest,
      workflowSnapshot: {
        ...manifest.workflowSnapshot,
        id: "draft-loop-output-isolation-test",
        nodes: {
          start: { id: "start", title: "收到任务", type: "trigger", next: "items", requirementIds: [] },
          items: {
            id: "items", title: "逐项处理", type: "loop", next: null,
            loop: { collectionPath: "input.items", itemKey: "item", maxIterations: 2, bodyNext: "check", exitNext: "done" },
            requirementIds: [],
          },
          check: {
            id: "check", title: "判断是否生成", type: "condition", next: null,
            condition: {
              source: "context.currentItem.generate", operator: "eq",
              branches: [{ label: "需要生成", value: true, next: "write" }], defaultNext: "quality",
            },
            requirementIds: [],
          },
          write: {
            id: "write", title: "生成交付内容", type: "ai", next: "quality",
            retry: { maxAttempts: 1, backoffMs: 50 }, requirementIds: [],
          },
          quality: {
            id: "quality", title: "检查本项交付", type: "rule", next: "items", onErrorNext: "items",
            quality: { requiredOutputTitles: ["生成交付内容"], minOutputCount: 1, checkToolReceipts: false, checkHumanBoundary: false },
            requirementIds: [],
          },
          done: { id: "done", title: "流程结束", type: "end", next: null, requirementIds: [] },
        },
      },
    });
    const runId = await runWith({ items: [{ generate: true }, { generate: false }] }, isolatedManifest);
    try {
      const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
      expect(run?.result).toMatchObject({
        items: {
          processedCount: 2,
          iterations: [
            { bodyOutput: { passed: true } },
            { bodyOutput: { status: "failed", error: expect.stringContaining("还没有形成结果") } },
          ],
        },
      });
    } finally {
      await cleanup(runId);
    }
  }, 240_000);

  it("内层循环逐个读取当前外层项的列表，不沿用上一个客户的处理状态", async () => {
    const nestedManifest = AgentManifest.parse({
      ...manifest,
      workflowSnapshot: {
        ...manifest.workflowSnapshot,
        id: "draft-nested-loop-runtime-test",
        nodes: {
          start: { id: "start", title: "收到任务", type: "trigger", next: "customers", requirementIds: [] },
          customers: {
            id: "customers", title: "逐位客户", type: "loop", next: null,
            loop: { collectionPath: "input.customers", itemKey: "customer", maxIterations: 3, bodyNext: "orders", exitNext: "done" },
            requirementIds: [],
          },
          orders: {
            id: "orders", title: "逐笔订单", type: "loop", next: null,
            loop: { collectionPath: "context.currentItem.orders", itemKey: "order", maxIterations: 3, bodyNext: "process", exitNext: "customers" },
            requirementIds: [],
          },
          process: { id: "process", title: "处理订单", type: "ai", next: "orders", requirementIds: [] },
          done: { id: "done", title: "流程结束", type: "end", next: null, requirementIds: [] },
        },
      },
    });
    const runId = await runWith({
      customers: [
        { id: "C-1", orders: [{ id: "O-1" }, { id: "O-2" }] },
        { id: "C-2", orders: [] },
        { id: "C-3", orders: [{ id: "O-3" }] },
      ],
    }, nestedManifest);
    try {
      const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
      expect(run?.status).toBe("completed");
      expect(run?.result).toMatchObject({
        customers: {
          processedCount: 3,
          iterations: [
            { item: { id: "C-1" }, bodyOutput: { processedCount: 2, iterations: [{ item: { id: "O-1" } }, { item: { id: "O-2" } }] } },
            { item: { id: "C-2" }, bodyOutput: { processedCount: 0, iterations: [] } },
            { item: { id: "C-3" }, bodyOutput: { processedCount: 1, iterations: [{ item: { id: "O-3" } }] } },
          ],
        },
      });
    } finally {
      await cleanup(runId);
    }
  }, 240_000);

  it("内层步骤走备用路径返回外层循环时清理内层状态", async () => {
    const fallbackManifest = AgentManifest.parse({
      ...manifest,
      workflowSnapshot: {
        ...manifest.workflowSnapshot,
        id: "draft-nested-loop-fallback-test",
        nodes: {
          start: { id: "start", title: "收到任务", type: "trigger", next: "customers", requirementIds: [] },
          customers: {
            id: "customers", title: "逐位客户", type: "loop", next: null,
            loop: { collectionPath: "input.customers", itemKey: "customer", maxIterations: 2, bodyNext: "orders", exitNext: "done" },
            requirementIds: [],
          },
          orders: {
            id: "orders", title: "逐笔订单", type: "loop", next: null,
            loop: { collectionPath: "context.currentItem.orders", itemKey: "order", maxIterations: 2, bodyNext: "send", exitNext: "customers" },
            requirementIds: [],
          },
          send: {
            id: "send", title: "发送订单", type: "tool", next: "orders", onErrorNext: "customers", requirementIds: [],
          },
          done: { id: "done", title: "流程结束", type: "end", next: null, requirementIds: [] },
        },
      },
    });
    const runId = await runWith({
      customers: [
        { id: "C-1", orders: [{ id: "O-1" }] },
        { id: "C-2", orders: [{ id: "O-2" }] },
      ],
    }, fallbackManifest);
    try {
      const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
      expect(run?.status).toBe("completed");
      expect(run?.result).toMatchObject({
        customers: {
          processedCount: 2,
          iterations: [
            { item: { id: "C-1" }, bodyOutput: { status: "failed" } },
            { item: { id: "C-2" }, bodyOutput: { status: "failed" } },
          ],
        },
      });
      const [sendStep] = await db.select().from(runSteps).where(and(eq(runSteps.runId, runId), eq(runSteps.nodeId, "send"))).limit(1);
      expect(sendStep?.attempt).toBe(2);
    } finally {
      await cleanup(runId);
    }
  }, 240_000);

  it("循环体知识步骤按当前项检索，不重复使用整次运行的问题", async () => {
    const sourceId = "00000000-0000-4000-8000-0000000000fa";
    const input = {
      question: "整次运行的概括问题",
      customers: [{ question: "甲公司退款期限" }, { question: "乙公司续约期限" }],
    };
    const knowledgeManifest = AgentManifest.parse({
      ...manifest,
      knowledgeSnapshot: [sourceId],
      workflowSnapshot: {
        ...manifest.workflowSnapshot,
        id: "draft-loop-knowledge-test",
        nodes: {
          start: { id: "start", title: "收到任务", type: "trigger", next: "customers", requirementIds: [] },
          customers: {
            id: "customers", title: "逐位客户", type: "loop", next: null,
            loop: { collectionPath: "input.customers", itemKey: "customer", maxIterations: 2, bodyNext: "lookup", exitNext: "done" },
            requirementIds: [],
          },
          lookup: {
            id: "lookup", title: "读取客户资料", type: "knowledge", next: "customers",
            knowledge: { space: "客户资料" }, requirementIds: [],
          },
          done: { id: "done", title: "流程结束", type: "end", next: null, requirementIds: [] },
        },
      },
    });
    await db.insert(knowledgeSources).values({
      id: sourceId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
      name: "客户政策", mime: "text/plain", sizeBytes: 100,
      sha256: `loop-knowledge-${sourceId}`, status: "indexed", chunkCount: 2,
    });
    await db.insert(knowledgeChunks).values([
      { workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, sourceId, chunkIndex: 0, content: "甲公司退款期限是签收后七天。", charStart: 0, charEnd: 14 },
      { workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, sourceId, chunkIndex: 1, content: "乙公司续约期限是合同到期前三十天。", charStart: 14, charEnd: 34 },
    ]);
    const [row] = await db.insert(runs).values({
      workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
      agentId: AGENT_ID, versionId: VERSION_ID, status: "queued", input,
    }).returning({ id: runs.id });
    try {
      const handle = await start(agentRunWorkflow, [row.id, knowledgeManifest, input]);
      await handle.returnValue;
      const [run] = await db.select().from(runs).where(eq(runs.id, row.id)).limit(1);
      expect(run?.status).toBe("completed");
      expect(run?.result).toMatchObject({
        customers: {
          processedCount: 2,
          iterations: [
            { bodyOutput: { query: "甲公司退款期限", hits: [expect.objectContaining({ excerpt: expect.stringContaining("甲公司退款期限") })] } },
            { bodyOutput: { query: "乙公司续约期限", hits: [expect.objectContaining({ excerpt: expect.stringContaining("乙公司续约期限") })] } },
          ],
        },
      });
    } finally {
      await cleanup(row.id);
      await db.delete(knowledgeChunks).where(eq(knowledgeChunks.sourceId, sourceId));
      await db.delete(knowledgeSources).where(eq(knowledgeSources.id, sourceId));
    }
  }, 240_000);
});
