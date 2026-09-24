import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentManifest } from "@/contracts/manifest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { agentVersions, agents } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { restoreVersionAction } from "@/server/actions/restore-version";

const AGENT_ID = "00000000-0000-4000-8000-0000000000d1";
const CURRENT_ID = "00000000-0000-4000-8000-0000000000d2";
const SOURCE_ID = "00000000-0000-4000-8000-0000000000d3";

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
  await db.delete(agentVersions).where(eq(agentVersions.agentId, AGENT_ID));
  await db.delete(agents).where(eq(agents.id, AGENT_ID));
});

async function insertVersions(sourceStatus: "candidate" | "superseded" | "retired") {
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
      manifest,
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

  it("恢复已退役版本时创建新的正式版本并退役原当前版本", async () => {
    await insertVersions("retired");

    const result = await restoreVersionAction(AGENT_ID, SOURCE_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.version).toMatchObject({ version: 3, status: "production" });
    const [oldCurrent] = await db
      .select()
      .from(agentVersions)
      .where(and(eq(agentVersions.id, CURRENT_ID), eq(agentVersions.agentId, AGENT_ID)));
    expect(oldCurrent.status).toBe("retired");
  });
});
