import { eq, inArray } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import intentGolden from "../fixtures/domain/intent-golden-1.json";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { agentVersions, agents, auditEvents, evaluationRuns, knowledgeSources, workflowDefinitions } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { publishVersionAction } from "@/server/actions/publish-version";
import { buildAgentDraft, buildManifest } from "@/server/domain/pipeline";
import { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";

const AGENT_ID = "00000000-0000-4000-8000-0000000000c1";
const VERSION_ID = "00000000-0000-4000-8000-0000000000c2";
const DEFINITION_ID = "00000000-0000-4000-8000-0000000000c3";
const KNOWLEDGE_ID = "00000000-0000-4000-8000-0000000000c4";

beforeEach(() => {
  vi.stubEnv("MODEL_MOCK", "1");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  const versions = await db.select({ id: agentVersions.id }).from(agentVersions).where(eq(agentVersions.agentId, AGENT_ID));
  await db.delete(auditEvents).where(inArray(auditEvents.targetId, [AGENT_ID, ...versions.map((version) => version.id)]));
  await db.delete(evaluationRuns).where(eq(evaluationRuns.agentId, AGENT_ID));
  await db.delete(agentVersions).where(eq(agentVersions.agentId, AGENT_ID));
  await db.delete(workflowDefinitions).where(eq(workflowDefinitions.agentId, AGENT_ID));
  await db.delete(agents).where(eq(agents.id, AGENT_ID));
  await db.delete(knowledgeSources).where(eq(knowledgeSources.id, KNOWLEDGE_ID));
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
    knowledgeSnapshot: [KNOWLEDGE_ID],
  });
  await db.insert(knowledgeSources).values({
    id: KNOWLEDGE_ID,
    workspaceId: DEMO_WORKSPACE_ID,
    createdBy: DEMO_USER_ID,
    name: "客服资料",
    mime: "text/plain",
    sizeBytes: 10,
    sha256: "c".repeat(64),
    status: "indexed",
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
  it.each(["root", "subflow", "parallel"])("发布冻结 %s 来源字段，修改草稿不改原版本", async (mode) => {
    await insertFixture();
    const [definition] = await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, DEFINITION_ID));
    const existing = WorkflowDraft.parse(definition.draft);
    const internal = { id: "extract", title: "内部提取业务对象", type: "ai" };
    const sourceNodeId = mode === "root" ? "step_5" : mode === "subflow" ? "step_5.extract" : "step_5.work.extract";
    const field = { path: "交付.金额", label: "业务金额", required: true, sourceNodeId, sourcePath: ["rows", "0", "amount"] };
    const nodes = { ...existing.nodes };
    if (mode !== "root") nodes.step_5 = WorkflowNode.parse({
      id: "step_5", title: nodes.step_5.title, next: nodes.step_5.next, type: mode === "subflow" ? "subflow" : "parallel",
      businessSpec: nodes.step_5.businessSpec,
      ...(mode === "subflow" ? { subflow: { name: "业务提取", steps: [internal] } }
        : { parallel: { strategy: "all", failurePolicy: "fail_fast", branches: [{ id: "work", label: "业务提取", steps: [internal] }, { id: "record", label: "独立记录", steps: [{ id: "note", title: "记录处理", type: "system" }] }] } }),
    });
    const changed = WorkflowDraft.parse({ ...existing, nodes, outputContract: { fields: [field] } });
    await db.update(workflowDefinitions).set({ draft: changed }).where(eq(workflowDefinitions.id, DEFINITION_ID));
    const published = await publishVersionAction(AGENT_ID);
    expect(published.ok).toBe(true);
    if (!published.ok) throw new Error(published.error);
    const [version] = await db.select().from(agentVersions).where(eq(agentVersions.id, published.version.id));
    expect(version.manifest.outputContract?.fields).toEqual([field]);
    expect(version.manifest.workflowSnapshot.outputContract?.fields).toEqual([field]);
    const next = WorkflowDraft.parse({ ...changed, outputContract: { fields: [{ ...field, sourcePath: ["rows", "0", "other"] }] } });
    await db.update(workflowDefinitions).set({ draft: next }).where(eq(workflowDefinitions.id, DEFINITION_ID));
    const [frozen] = await db.select().from(agentVersions).where(eq(agentVersions.id, published.version.id));
    expect(frozen.manifest.outputContract?.fields).toEqual([field]);
    expect(frozen.manifest.workflowFingerprint).toBe(version.manifest.workflowFingerprint);
    const nextPublished = await publishVersionAction(AGENT_ID);
    expect(nextPublished.ok).toBe(true);
    if (!nextPublished.ok) throw new Error(nextPublished.error);
    expect(nextPublished.version.id).not.toBe(published.version.id);
  });

  it("凭据字段选择在发布前拒绝，不创建新版本", async () => {
    await insertFixture();
    const [definition] = await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.id, DEFINITION_ID));
    const draft = WorkflowDraft.parse({ ...definition.draft, outputContract: { fields: [{ path: "交付", required: true, sourceNodeId: "step_5", sourcePath: ["apiKey"] }] } });
    await db.update(workflowDefinitions).set({ draft }).where(eq(workflowDefinitions.id, DEFINITION_ID));
    expect(await publishVersionAction(AGENT_ID)).toMatchObject({ ok: false, error: expect.stringContaining("凭据") });
    expect(await db.select().from(agentVersions).where(eq(agentVersions.agentId, AGENT_ID))).toHaveLength(1);
  });

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
