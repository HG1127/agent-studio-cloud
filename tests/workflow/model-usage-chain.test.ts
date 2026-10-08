import { eq, inArray } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { start } from "workflow/api";
import { AgentManifest } from "@/contracts/manifest";
import { agents, agentVersions, runSteps, runs, traceEvents } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { getRunModelUsageChain } from "@/server/queries/model-usage-chain";
import { agentRunWorkflow } from "@/server/workflows/agent-run";
import { startModelJsonServer } from "../helpers/model-json-server";

describe("实际持久多助手的整链模型用量", () => {
  it.each(["agent_call", "handoff"] as const)("%s 自动保存明确父关系，从子运行汇总父子实际调用", async (kind) => {
    const service = await startModelJsonServer(["主助手已整理任务", "协作助手已处理任务"]);
    const rootRunId = crypto.randomUUID(), rootAgentId = crypto.randomUUID(), targetAgentId = crypto.randomUUID(), targetVersionId = crypto.randomUUID();
    const owned = [rootRunId];
    try {
      vi.stubEnv("MODEL_BASE_URL", service.baseUrl + "/v1"); vi.stubEnv("MODEL_API_KEY", "test-chain-only-key"); vi.stubEnv("MODEL_ID", "test-model"); vi.stubEnv("REAL_MODELS_ENABLED", "1");
      const base = { schemaVersion: "4.0", workflowFingerprint: "model-usage-chain-test", inputContract: { fields: [] }, resourceSelection: { model: { modelId: "test-model", mock: false } }, designAudit: { status: "passed", issueCount: 0, criticalCount: 0 } };
      const outputContract = { fields: [{ path: "work", label: "处理结果", required: true, sourceNodeId: "work" }] };
      const target = AgentManifest.parse({ ...base, outputContract, workflowSnapshot: { id: "usage-child", startNodeId: "start", outputContract, rootAgent: { id: targetAgentId, name: "协作助手", role: "测试" }, memoryPolicy: { taskContext: true, longTerm: false }, nodes: {
        start: { id: "start", title: "开始", type: "trigger", next: "work" }, work: { id: "work", title: "处理任务", type: "ai", next: "done" }, done: { id: "done", title: "完成", type: "end", next: null },
      } } });
      await db.insert(agents).values({ id: targetAgentId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, name: "协作助手", intentText: "处理任务", status: "published" });
      await db.insert(agentVersions).values({ id: targetVersionId, agentId: targetAgentId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, version: 1, status: "production", manifest: target });
      const delegate = { id: "delegate", title: "协作处理", type: kind, next: "done", ...(kind === "agent_call" ? { agentCall: { targetAgentId, versionId: targetVersionId, outputContract } } : { toAgent: { id: targetAgentId, name: "协作助手", versionId: targetVersionId }, contract: {
        deliverables: ["处理结果"], mustNotInclude: ["密钥"],
        inputSchema: [{ name: "brief", type: "string", required: true }],
        outputSchema: [{ name: "work", type: "string", required: true }],
        memoryPolicy: { mode: "none", shared: [], private: ["密钥"] },
      } }) };
      const parent = AgentManifest.parse({ ...base, workflowSnapshot: { id: "usage-parent", startNodeId: "start", rootAgent: { id: rootAgentId, name: "主助手", role: "统筹" }, memoryPolicy: { taskContext: true, longTerm: false }, nodes: {
        start: { id: "start", title: "开始", type: "trigger", next: "prepare" }, prepare: { id: "prepare", title: "整理任务", type: "ai", next: "delegate" }, delegate, done: { id: "done", title: "完成", type: "end", next: null },
      } } });
      await db.insert(runs).values({ id: rootRunId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, agentId: rootAgentId, versionId: crypto.randomUUID(), status: "queued", input: {} });
      const handle = await start(agentRunWorkflow, [rootRunId, parent, {}]); await expect(handle.returnValue).resolves.toEqual({ status: "completed" });
      const children = await db.select().from(runs).where(eq(runs.parentRunId, rootRunId)); owned.push(...children.map((row) => row.id));
      expect(children).toHaveLength(1); expect(children[0]).toMatchObject({ workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, sourceType: kind, parentRunId: rootRunId, status: "completed", collaborationTrackingVersion: "v1" });
      expect(children[0].result).toEqual({ work: "协作助手已处理任务" });
      expect(service.modelRequests).toHaveLength(2);
      const summary = await getRunModelUsageChain(DEMO_WORKSPACE_ID, children[0].id);
      expect(summary).toMatchObject({ requestedRunId: children[0].id, rootRunId, graph: { includedRuns: 2, complete: true, untrackedRelationRuns: 0 }, calls: { total: 2, returned: 2, pending: 0, failed: 0 }, usage: { knownInputTokens: 24, knownOutputTokens: 12, knownCallTotalTokens: 36, recordedUsageComplete: true }, execution: { finishedRuns: 2, liveRuns: 0, isFinalSnapshot: true } });
    } finally {
      const children = await db.select({ id: runs.id }).from(runs).where(eq(runs.parentRunId, rootRunId)); owned.push(...children.map((row) => row.id));
      await service.close(); vi.unstubAllEnvs();
      await db.delete(traceEvents).where(inArray(traceEvents.runId, owned)); await db.delete(runSteps).where(inArray(runSteps.runId, owned)); await db.delete(runs).where(inArray(runs.id, owned));
      await db.delete(agentVersions).where(eq(agentVersions.id, targetVersionId)); await db.delete(agents).where(eq(agents.id, targetAgentId));
    }
  }, 240_000);
});
