import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { AgentManifest } from "@/contracts/manifest";
import { agentVersions, agents, runs } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { getAgentDetail } from "@/server/queries/agents";
import { getRunView, listRuns } from "@/server/queries/runs";
import { listVersions } from "@/server/queries/versions";

const OTHER_WS = "00000000-0000-4000-8000-0000000000ff";
const AGENT_ID = "00000000-0000-4000-8000-0000000000e1";
const RUN_ID = "00000000-0000-4000-8000-0000000000e2";
const VERSION_ID = "00000000-0000-4000-8000-0000000000e3";
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
  await db.delete(runs).where(eq(runs.id, RUN_ID));
  await db.delete(agentVersions).where(eq(agentVersions.id, VERSION_ID));
  await db.delete(agents).where(eq(agents.id, AGENT_ID));
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

    expect(await getAgentDetail(AGENT_ID, OTHER_WS)).toBeNull();
    expect(await listVersions(AGENT_ID, OTHER_WS)).toHaveLength(0);
    expect(await listVersions(AGENT_ID, DEMO_WORKSPACE_ID)).toMatchObject([{ id: VERSION_ID, version: 1 }]);
  });
  it("已归档助手的历史运行仍保留并明确标记", async () => {
    await db.update(agents).set({ archivedAt: new Date() }).where(eq(agents.id, AGENT_ID));
    const list = await listRuns(DEMO_WORKSPACE_ID);
    expect(list.find((r) => r.id === RUN_ID)).toMatchObject({ id: RUN_ID, agentArchived: true });
    expect(await getRunView(RUN_ID, DEMO_WORKSPACE_ID)).toMatchObject({ id: RUN_ID, agentArchived: true });
  });
});
