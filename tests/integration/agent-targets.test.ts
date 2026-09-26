import { inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { AgentManifest } from "@/contracts/manifest";
import { agentVersions, agents } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { listAgentTargets } from "@/server/queries/agents";

const ROOT_ID = "00000000-0000-4000-8000-0000000000a1";
const TARGET_ID = "00000000-0000-4000-8000-0000000000a2";
const RETIRED_ID = "00000000-0000-4000-8000-0000000000a3";
const PRODUCTION_ID = "00000000-0000-4000-8000-0000000000a4";

const manifest = AgentManifest.parse({
  schemaVersion: "4.0",
  workflowFingerprint: "agent-targets-test",
  workflowSnapshot: {
    id: "workflow",
    rootAgent: { id: TARGET_ID, name: "协作助手", role: "研究" },
    nodes: {
      start: { id: "start", title: "开始", type: "trigger", next: "done" },
      done: { id: "done", title: "完成", type: "end", next: null },
    },
    memoryPolicy: { taskContext: true, longTerm: false },
  },
  inputContract: { fields: [] },
  outputContract: { fields: [] },
  resourceSelection: { model: { modelId: "mock", mock: true } },
  designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
});

afterEach(async () => {
  await db.delete(agentVersions).where(inArray(agentVersions.id, [RETIRED_ID, PRODUCTION_ID]));
  await db.delete(agents).where(inArray(agents.id, [ROOT_ID, TARGET_ID]));
});

describe("协作助手版本选项", () => {
  it("除当前正式版本外仍返回草稿已选择的历史版本", async () => {
    await db.insert(agents).values([
      { id: ROOT_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, name: "主助手", intentText: "用于测试协作目标历史版本" },
      { id: TARGET_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, name: "协作助手", intentText: "用于测试协作目标历史版本" },
    ]);
    await db.insert(agentVersions).values([
      { id: RETIRED_ID, agentId: TARGET_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, version: 1, status: "retired", manifest },
      { id: PRODUCTION_ID, agentId: TARGET_ID, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, version: 2, status: "production", manifest },
    ]);

    const ownTargets = (selectedVersionIds: string[] = []) =>
      listAgentTargets(DEMO_WORKSPACE_ID, ROOT_ID, selectedVersionIds)
        .then((options) => options.filter((option) => option.agentId === TARGET_ID));
    expect(await ownTargets()).toMatchObject([{ versionId: PRODUCTION_ID, version: 2 }]);
    expect(await ownTargets([RETIRED_ID])).toMatchObject([
      { versionId: PRODUCTION_ID, version: 2 },
      { versionId: RETIRED_ID, version: 1 },
    ]);
  });
});
