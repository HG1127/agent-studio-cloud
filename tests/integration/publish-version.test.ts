import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import intentGolden from "../fixtures/domain/intent-golden-1.json";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { agentVersions, agents, evaluationRuns, workflowDefinitions } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { publishVersionAction } from "@/server/actions/publish-version";
import { buildAgentDraft, buildManifest } from "@/server/domain/pipeline";

const AGENT_ID = "00000000-0000-4000-8000-0000000000c1";
const VERSION_ID = "00000000-0000-4000-8000-0000000000c2";
const DEFINITION_ID = "00000000-0000-4000-8000-0000000000c3";

beforeEach(() => {
  vi.stubEnv("MODEL_MOCK", "1");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await db.delete(evaluationRuns).where(eq(evaluationRuns.agentId, AGENT_ID));
  await db.delete(agentVersions).where(eq(agentVersions.agentId, AGENT_ID));
  await db.delete(workflowDefinitions).where(eq(workflowDefinitions.agentId, AGENT_ID));
  await db.delete(agents).where(eq(agents.id, AGENT_ID));
});

async function insertFixture() {
  const compiled = buildAgentDraft({ name: intentGolden.input.name, intentText: intentGolden.input.text });
  if (!compiled.draft) throw new Error(`测试流程生成失败：${compiled.diagnostics.error ?? "未知原因"}`);
  const draft = {
    ...compiled.draft,
    outputContract: {
      fields: [{ path: "回复邮件", label: "回复邮件", required: true, sourceNodeId: "step_5" }],
    },
  };
  const manifest = buildManifest(draft, {
    modelId: "mock",
    mock: true,
    connectionId: null,
    knowledgeSnapshot: [],
  });
  await db.insert(agents).values({
    id: AGENT_ID,
    workspaceId: DEMO_WORKSPACE_ID,
    createdBy: DEMO_USER_ID,
    name: intentGolden.input.name,
    intentText: intentGolden.input.text,
  });
  await db.insert(workflowDefinitions).values({
    id: DEFINITION_ID,
    agentId: AGENT_ID,
    workspaceId: DEMO_WORKSPACE_ID,
    createdBy: DEMO_USER_ID,
    draft,
  });
  await db.insert(agentVersions).values({
    id: VERSION_ID,
    agentId: AGENT_ID,
    workspaceId: DEMO_WORKSPACE_ID,
    createdBy: DEMO_USER_ID,
    version: 1,
    status: "candidate",
    manifest,
  });
}

describe("发布版本", () => {
  it("自动验收运行期间不能替换正在验收的候选版本", async () => {
    await insertFixture();
    await db.insert(evaluationRuns).values({
      workspaceId: DEMO_WORKSPACE_ID,
      createdBy: DEMO_USER_ID,
      agentId: AGENT_ID,
      versionId: VERSION_ID,
      status: "running",
      totalCount: 1,
    });

    const result = await publishVersionAction(AGENT_ID);

    expect(result).toEqual({
      ok: false,
      error: "自动验收运行期间不能发布新版本，请等待验收完成",
      issues: [],
    });
    const versions = await db.select().from(agentVersions).where(eq(agentVersions.agentId, AGENT_ID));
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ id: VERSION_ID, status: "candidate", version: 1 });
  });

  it("同一冻结清单重复发布时复用最新版本", async () => {
    await insertFixture();
    await db.delete(agentVersions).where(eq(agentVersions.agentId, AGENT_ID));

    const first = await publishVersionAction(AGENT_ID);
    const second = await publishVersionAction(AGENT_ID);

    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    const versions = await db.select().from(agentVersions).where(eq(agentVersions.agentId, AGENT_ID));
    expect(versions).toHaveLength(1);
  });
});
