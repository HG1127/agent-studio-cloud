import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentManifest } from "@/contracts/manifest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { agentVersions, agents, evaluationRuns } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { restoreVersionAction } from "@/server/actions/restore-version";

const AGENT_ID = "00000000-0000-4000-8000-0000000000d1";
const CURRENT_ID = "00000000-0000-4000-8000-0000000000d2";
const SOURCE_ID = "00000000-0000-4000-8000-0000000000d3";
const CROSS_VERSION_ID = "00000000-0000-4000-8000-0000000000d4";
const PENDING_ID = "00000000-0000-4000-8000-0000000000d5";
const OTHER_WS = "00000000-0000-4000-8000-0000000000df";

const manifest = AgentManifest.parse({
  schemaVersion: "4.0",
  workflowFingerprint: "restore-test",
  workflowSnapshot: {
    id: "workflow",
    versionId: null,
    startNodeId: "start",
    rootAgent: { id: "agent", name: "恢复测试助手", role: "owner" },
    nodes: {
      start: { id: "start", title: "开始", type: "trigger", next: "end", requirementIds: [], businessSpec: null },
      end: { id: "end", title: "结束", type: "end", next: null, requirementIds: [], businessSpec: null },
    },
    variables: [],
    memoryPolicy: { taskContext: true, longTerm: false },
    outputContract: { fields: [] },
    ui: { positions: {} },
  },
  inputContract: { fields: [] },
  outputContract: { fields: [] },
  resourceSelection: { model: { modelId: "mock", mock: true, connectionId: null } },
  designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
  knowledgeSnapshot: [],
});

afterEach(async () => {
  await db.delete(evaluationRuns).where(eq(evaluationRuns.agentId, AGENT_ID));
  await db.delete(agentVersions).where(eq(agentVersions.agentId, AGENT_ID));
  await db.delete(agents).where(eq(agents.id, AGENT_ID));
});

async function insertVersions(
  sourceStatus: "candidate" | "superseded" | "retired",
  sourceManifest = manifest,
) {
  await db.insert(agents).values({
    id: AGENT_ID,
    workspaceId: DEMO_WORKSPACE_ID,
    createdBy: DEMO_USER_ID,
    name: "恢复测试助手",
    intentText: "验证历史版本恢复边界",
  });
  await db.insert(agentVersions).values([
    {
      id: CURRENT_ID,
      agentId: AGENT_ID,
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      version: 2,
      status: "production",
      manifest,
    },
    {
      id: SOURCE_ID,
      agentId: AGENT_ID,
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      version: 1,
      status: sourceStatus,
      manifest: sourceManifest,
    },
  ]);
}

describe("恢复历史版本", () => {
  it("不能把待验收版本直接恢复为当前版本", async () => {
    await insertVersions("candidate");

    const result = await restoreVersionAction(AGENT_ID, SOURCE_ID);

    expect(result).toEqual({ ok: false, error: "只有曾经上线的历史版本才能恢复为当前版本" });
    const versions = await db.select().from(agentVersions).where(eq(agentVersions.agentId, AGENT_ID));
    expect(versions).toHaveLength(2);
    expect(versions.find((version) => version.id === CURRENT_ID)?.status).toBe("production");
  });

  it("自动验收运行期间不能恢复历史版本", async () => {
    await insertVersions("retired");
    await db.insert(evaluationRuns).values({
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      agentId: AGENT_ID,
      versionId: CURRENT_ID,
      status: "running",
      totalCount: 1,
    });

    const result = await restoreVersionAction(AGENT_ID, SOURCE_ID);

    expect(result).toEqual({
      ok: false,
      error: "自动验收运行期间不能恢复历史版本，请等待验收完成",
    });
    const versions = await db.select().from(agentVersions).where(eq(agentVersions.agentId, AGENT_ID));
    expect(versions).toHaveLength(2);
    expect(versions.find((version) => version.id === CURRENT_ID)?.status).toBe("production");
  });

  it("恢复已退役版本时创建新的正式版本并退役原当前版本", async () => {
    await insertVersions("retired");
    await db.insert(agentVersions).values({
      id: PENDING_ID,
      agentId: AGENT_ID,
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      version: 3,
      status: "candidate",
      manifest,
    });
    await db.insert(agentVersions).values({
      id: CROSS_VERSION_ID,
      agentId: AGENT_ID,
      workspaceId: OTHER_WS,
      createdBy: DEMO_USER_ID,
      version: 99,
      status: "production",
      manifest,
    });

    const result = await restoreVersionAction(AGENT_ID, SOURCE_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.version).toMatchObject({ version: 4, status: "production" });
    const [oldCurrent] = await db
      .select()
      .from(agentVersions)
      .where(and(eq(agentVersions.id, CURRENT_ID), eq(agentVersions.agentId, AGENT_ID)));
    expect(oldCurrent.status).toBe("retired");
    const [pending] = await db.select().from(agentVersions).where(eq(agentVersions.id, PENDING_ID));
    expect(pending.status).toBe("superseded");
    const [restored] = await db.select().from(agentVersions).where(eq(agentVersions.id, result.version.id));
    const [crossVersion] = await db.select().from(agentVersions).where(eq(agentVersions.id, CROSS_VERSION_ID));
    expect(crossVersion.status).toBe("production");
    expect(restored.manifest.workflowSnapshot.rootAgent).toMatchObject({
      id: AGENT_ID,
      name: "恢复测试助手",
      role: "owner",
    });
  });

  it("知识快照已经不可用时不会替换当前版本", async () => {
    const missingSourceId = "00000000-0000-4000-8000-0000000000e1";
    const knowledgeManifest = AgentManifest.parse({
      ...manifest,
      workflowFingerprint: "restore-knowledge-test",
      workflowSnapshot: {
        ...manifest.workflowSnapshot,
        nodes: {
          start: { id: "start", title: "开始", type: "trigger", next: "knowledge" },
          knowledge: {
            id: "knowledge",
            title: "查询业务资料",
            type: "knowledge",
            next: "end",
            knowledge: { space: "业务资料库", sourceIds: [missingSourceId] },
          },
          end: { id: "end", title: "结束", type: "end", next: null },
        },
      },
      knowledgeSnapshot: [missingSourceId],
    });
    await insertVersions("retired", knowledgeManifest);

    const result = await restoreVersionAction(AGENT_ID, SOURCE_ID);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("需要知识资料");
    const versions = await db.select().from(agentVersions).where(eq(agentVersions.agentId, AGENT_ID));
    expect(versions).toHaveLength(2);
    expect(versions.find((version) => version.id === CURRENT_ID)?.status).toBe("production");
  });

  it("协作助手已经不可用时不会替换当前版本", async () => {
    const missingAgentId = "00000000-0000-4000-8000-0000000000e2";
    const missingVersionId = "00000000-0000-4000-8000-0000000000e3";
    const collaborationManifest = AgentManifest.parse({
      ...manifest,
      workflowFingerprint: "restore-collaboration-test",
      workflowSnapshot: {
        ...manifest.workflowSnapshot,
        nodes: {
          start: { id: "start", title: "开始", type: "trigger", next: "call" },
          call: {
            id: "call",
            title: "请协作助手处理",
            type: "agent_call",
            next: "end",
            agentCall: { targetAgentId: missingAgentId, versionId: missingVersionId },
          },
          end: { id: "end", title: "结束", type: "end", next: null },
        },
      },
    });
    await insertVersions("retired", collaborationManifest);

    const result = await restoreVersionAction(AGENT_ID, SOURCE_ID);

    expect(result).toEqual({
      ok: false,
      error: "协作链包含已停用、缺失或格式不完整的冻结版本，无法恢复这个历史版本",
    });
    const versions = await db.select().from(agentVersions).where(eq(agentVersions.agentId, AGENT_ID));
    expect(versions).toHaveLength(2);
    expect(versions.find((version) => version.id === CURRENT_ID)?.status).toBe("production");
  });
});
