import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { AgentManifest } from "@/contracts/manifest";
import { agentMemories, agentVersions, agents, runs } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { getAgentDetail, listAgents } from "@/server/queries/agents";
import { getRunView, listRuns } from "@/server/queries/runs";
import { listMemories } from "@/server/queries/memory";
import { listVersions } from "@/server/queries/versions";

const OTHER_WS = "00000000-0000-4000-8000-0000000000ff";
const AGENT_ID = "00000000-0000-4000-8000-0000000000e1";
const RUN_ID = "00000000-0000-4000-8000-0000000000e2";
const VERSION_ID = "00000000-0000-4000-8000-0000000000e3";
const CROSS_AGENT_ID = "00000000-0000-4000-8000-0000000000e4";
const CROSS_RUN_ID = "00000000-0000-4000-8000-0000000000e5";
const CROSS_MEMORY_ID = "00000000-0000-4000-8000-0000000000e6";
const CROSS_VERSION_ID = "00000000-0000-4000-8000-0000000000e7";
const IDEMPOTENT_RUN_ID = "00000000-0000-4000-8000-0000000000e8";
const CROSS_IDEMPOTENT_RUN_ID = "00000000-0000-4000-8000-0000000000e9";
const SHARED_SOURCE_KEY = "tenant-test:shared-request";
const manifest = AgentManifest.parse({
  schemaVersion: "4.0",
  workflowFingerprint: "e".repeat(64),
  inputContract: { fields: [] },
  resourceSelection: { model: { modelId: "mock", mock: true } },
  designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
  workflowSnapshot: {
    id: "tenant-test",
    startNodeId: "start",
    rootAgent: { id: AGENT_ID, name: "租户测试助手", role: "主助手" },
    nodes: {
      start: { id: "start", title: "开始", type: "trigger", next: "done" },
      done: { id: "done", title: "完成", type: "end", next: null },
    },
    variables: [], memoryPolicy: { taskContext: true, longTerm: false }, ui: { positions: {} },
  },
});

// 独立工作区的 agent + run：验证错租户取不到、助手归档后历史运行仍可追溯
// 常量编号 0e1/0e2：避开 run-failure.test.ts 已占用的 0d1/0d2（各测试共用同一 Neon 库）
afterAll(async () => {
  await db.delete(agentMemories).where(eq(agentMemories.id, CROSS_MEMORY_ID));
  await db.delete(runs).where(inArray(runs.id, [RUN_ID, CROSS_RUN_ID, IDEMPOTENT_RUN_ID, CROSS_IDEMPOTENT_RUN_ID]));
  await db.delete(agentVersions).where(inArray(agentVersions.id, [VERSION_ID, CROSS_VERSION_ID]));
  await db.delete(agents).where(inArray(agents.id, [AGENT_ID, CROSS_AGENT_ID]));
});

describe("租户过滤", () => {
  it("错租户读 run 返回 null，本租户可读", async () => {
    await db.insert(agents).values({
      id: AGENT_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
      name: "租户测试助手", intentText: "测试意图，至少十个字以上", status: "draft",
    }).onConflictDoNothing();
    await db.insert(runs).values({
      id: RUN_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
      agentId: AGENT_ID, versionId: AGENT_ID, status: "completed", input: {},
    }).onConflictDoNothing();
    expect(await getRunView(RUN_ID, OTHER_WS)).toBeNull();
    const view = await getRunView(RUN_ID, DEMO_WORKSPACE_ID);
    expect(view?.id).toBe(RUN_ID);
  });
  it("助手详情和版本列表各自执行工作区隔离", async () => {
    await db.insert(agentVersions).values({
      id: VERSION_ID,
      agentId: AGENT_ID,
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      version: 1,
      status: "production",
      manifest,
    }).onConflictDoNothing();
    await db.insert(agentVersions).values({
      id: CROSS_VERSION_ID,
      agentId: AGENT_ID,
      workspaceId: OTHER_WS,
      createdBy: DEMO_USER_ID,
      version: 2,
      status: "production",
      manifest,
    }).onConflictDoNothing();

    expect(await getAgentDetail(AGENT_ID, OTHER_WS)).toBeNull();
    expect(await listVersions(AGENT_ID, OTHER_WS)).toHaveLength(0);
    expect(await listVersions(AGENT_ID, DEMO_WORKSPACE_ID)).toMatchObject([{ id: VERSION_ID, version: 1 }]);
    expect((await listAgents(DEMO_WORKSPACE_ID)).find((agent) => agent.id === AGENT_ID)?.versionCount).toBe(1);
  });
  it("已归档助手的历史运行仍保留并明确标记", async () => {
    await db.update(agents).set({ archivedAt: new Date() }).where(eq(agents.id, AGENT_ID));
    const list = await listRuns(DEMO_WORKSPACE_ID);
    expect(list.find((r) => r.id === RUN_ID)).toMatchObject({ id: RUN_ID, agentArchived: true });
    expect(await getRunView(RUN_ID, DEMO_WORKSPACE_ID)).toMatchObject({ id: RUN_ID, agentArchived: true });
  });
  it("拒绝拼接到其他工作区助手的脏运行记录", async () => {
    await db.insert(agents).values({
      id: CROSS_AGENT_ID, workspaceId: OTHER_WS, createdBy: DEMO_USER_ID,
      name: "其他工作区助手", intentText: "用于验证联表两侧工作区隔离",
    });
    await db.insert(runs).values({
      id: CROSS_RUN_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
      agentId: CROSS_AGENT_ID, versionId: CROSS_AGENT_ID, status: "completed", input: {},
    });
    await db.insert(agentMemories).values({
      id: CROSS_MEMORY_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID,
      agentId: CROSS_AGENT_ID, sourceRunId: CROSS_RUN_ID, sourceNodeId: "cross_node",
      content: "不应出现在演示工作区的经验", metadata: {},
    });

    expect(await getRunView(CROSS_RUN_ID, DEMO_WORKSPACE_ID)).toBeNull();
    expect((await listRuns(DEMO_WORKSPACE_ID)).some((run) => run.id === CROSS_RUN_ID)).toBe(false);
    expect((await listMemories()).some((memory) => memory.id === CROSS_MEMORY_ID)).toBe(false);
  });
  it("相同幂等来源键可以在不同工作区各启动一次", async () => {
    await db.insert(runs).values([
      {
        id: IDEMPOTENT_RUN_ID,
        workspaceId: DEMO_WORKSPACE_ID,
        createdBy: DEMO_USER_ID,
        agentId: AGENT_ID,
        versionId: VERSION_ID,
        status: "completed",
        input: {},
        sourceKey: SHARED_SOURCE_KEY,
      },
      {
        id: CROSS_IDEMPOTENT_RUN_ID,
        workspaceId: OTHER_WS,
        createdBy: DEMO_USER_ID,
        agentId: CROSS_AGENT_ID,
        versionId: CROSS_VERSION_ID,
        status: "completed",
        input: {},
        sourceKey: SHARED_SOURCE_KEY,
      },
    ]);

    const created = await db.select({ id: runs.id }).from(runs).where(inArray(runs.id, [IDEMPOTENT_RUN_ID, CROSS_IDEMPOTENT_RUN_ID]));
    expect(created).toHaveLength(2);
  });
});
