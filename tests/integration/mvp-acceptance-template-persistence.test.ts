import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentManifest } from "@/contracts/manifest";
import { WorkflowDraft } from "@/contracts/workflow";
import { agents, agentVersions, auditEvents, workflowDefinitions } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { createMvpAgentAction } from "@/server/actions/create-mvp-agent";
import { publishVersionAction } from "@/server/actions/publish-version";
import { auditWorkflow } from "@/server/domain/audit";
import { assertMvpAcceptanceIsolatedDb, cleanupMvpAcceptanceTemplate, prepareMvpAcceptanceTemplate, type MvpAcceptanceTemplateContext } from "../helpers/mvp-acceptance-template";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
beforeAll(assertMvpAcceptanceIsolatedDb);
let context: MvpAcceptanceTemplateContext | undefined;
afterEach(async () => {
  if (context) await cleanupMvpAcceptanceTemplate(context);
  context = undefined;
}, 60_000);

function noSdkRequests() {
  expect(context!.tools.messages).toHaveLength(0);
  expect(context!.tools.writes).toHaveLength(0);
  expect(context!.model.modelRequests).toHaveLength(0);
}
async function saveTemplate() {
  const saved = await createMvpAgentAction(context!.spec, context!.agentId);
  expect(saved).toEqual({ ok: true, agentId: context!.agentId });
}
async function versions() {
  return db.select().from(agentVersions).where(and(eq(agentVersions.agentId, context!.agentId), eq(agentVersions.workspaceId, DEMO_WORKSPACE_ID)));
}

// 保存和发布不启动引擎；真实 Workflow 证据由独立的生产模板套件提供。
describe("MVP 生产模板工厂到真实保存和发布事务（仅 CI 临时隔离库）", () => {
  it("生产工厂产物通过真实创建 action 保存，同一请求只留下一个助手、草稿和导入审计", async () => {
    context = await prepareMvpAcceptanceTemplate();
    expect(context.built.draft.nodes.execute.toolOperation).toEqual({ scope: context.spec.actionToolId, key: { kind: "input", path: ["requestId"] } });
    await saveTemplate();
    await saveTemplate();
    const savedAgents = await db.select().from(agents).where(eq(agents.id, context.agentId));
    const definitions = await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.agentId, context.agentId));
    const imports = await db.select().from(auditEvents).where(and(eq(auditEvents.targetId, context.agentId), eq(auditEvents.action, "agent.imported")));
    expect(savedAgents).toHaveLength(1);
    expect(definitions).toHaveLength(1);
    expect(imports).toHaveLength(1);
    const owner = { workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID };
    expect(savedAgents[0]).toMatchObject({ ...owner, id: context.agentId, status: "draft", intentText: context.built.intentText });
    expect(definitions[0]).toMatchObject(owner);
    expect(imports[0]).toMatchObject({ ...owner, data: { importFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) } });
    const draft = WorkflowDraft.parse(definitions[0].draft);
    expect(draft.rootAgent).toMatchObject({ id: context.agentId, name: context.spec.name });
    expect(draft.nodes).toEqual(context.built.draft.nodes);
    expect(draft.variables).toEqual(context.built.draft.variables);
    expect(draft.outputContract).toEqual(context.built.draft.outputContract);
    expect(await versions()).toHaveLength(0);
    expect(await createMvpAgentAction({ ...context.spec, businessGoal: "这是同一创建请求中被改变的业务目标内容" }, context.agentId)).toMatchObject({ ok: false, error: expect.stringContaining("已经失效") });
    expect(await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.agentId, context.agentId))).toHaveLength(1);
    expect(JSON.stringify(draft)).not.toMatch(/127\.0\.0\.1|test-acceptance-registry-only|test-template-model-only-key/);
    noSdkRequests();
  });

  it("真实创建入口拒绝非模板方案来源，不产生半保存记录", async () => {
    context = await prepareMvpAcceptanceTemplate();
    const invalid = { ...context.spec, actionMapping: { fields: context.spec.actionMapping.fields.map((binding) => ({ ...binding, source: { kind: "output", nodeId: "read", path: binding.target } })) } };
    expect(await createMvpAgentAction(invalid, context.agentId)).toMatchObject({ ok: false, error: expect.stringContaining("待审批方案") });
    expect(await db.select().from(agents).where(eq(agents.id, context.agentId))).toHaveLength(0);
    expect(await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.agentId, context.agentId))).toHaveLength(0);
    expect(await versions()).toHaveLength(0);
    expect(await db.select().from(auditEvents).where(eq(auditEvents.targetId, context.agentId))).toHaveLength(0);
    noSdkRequests();
  });

  it("保存后的模板不能绕过真实模型配置门禁发布", async () => {
    context = await prepareMvpAcceptanceTemplate();
    await saveTemplate();
    vi.stubEnv("MODEL_ID", "");
    expect(await publishVersionAction(context.agentId)).toMatchObject({ ok: false, error: expect.stringContaining("模型尚未配置") });
    expect(await versions()).toHaveLength(0);
    noSdkRequests();
  });

  it("保存后当前登记字段漂移，真实发布入口拒绝冻结版本", async () => {
    context = await prepareMvpAcceptanceTemplate();
    await saveTemplate();
    vi.stubEnv("TOOL_REGISTRY_JSON", JSON.stringify(context.registry.map((tool) => tool.id === context!.spec.actionToolId
      ? { ...tool, inputSchema: { ...tool.inputSchema, properties: { ...context!.tools.readSchema.properties, amount: { type: "string" }, approved: { type: "boolean" } } } } : tool)));
    expect(await publishVersionAction(context.agentId)).toMatchObject({ ok: false, error: expect.stringContaining("配置已变化") });
    expect(await versions()).toHaveLength(0);
    noSdkRequests();
  });

  it("没有验收样例时按现有策略发布生产版本，冻结真实草稿、必填输入和交付来源并防重", async () => {
    context = await prepareMvpAcceptanceTemplate();
    await saveTemplate();
    const published = await publishVersionAction(context.agentId);
    expect(published).toMatchObject({ ok: true, release: "production", version: { status: "production", version: 1 } });
    if (!published.ok) throw new Error(published.error);
    const repeated = await publishVersionAction(context.agentId);
    expect(repeated).toEqual(published);
    const rows = await versions();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: published.version.id, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID });
    const [definition] = await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.agentId, context.agentId));
    const draft = WorkflowDraft.parse(definition.draft);
    const manifest = AgentManifest.parse(rows[0].manifest);
    expect(manifest.workflowSnapshot).toEqual(draft);
    expect(manifest.workflowFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.resourceSelection.model).toEqual({ modelId: "test-model", mock: false, connectionId: null });
    expect(manifest.inputContract.fields).toEqual(context.spec.inputs.map((field) => ({ ...field, required: true })));
    expect(manifest.outputContract).toEqual(context.built.draft.outputContract);
    const audit = auditWorkflow(draft);
    expect(manifest.designAudit).toMatchObject({ issueCount: audit.issues.length, criticalCount: audit.counts.critical });
    const publishedAudits = await db.select().from(auditEvents).where(and(eq(auditEvents.targetId, published.version.id), eq(auditEvents.action, "version.published")));
    expect(publishedAudits).toHaveLength(1);
    expect(publishedAudits[0]).toMatchObject({ workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, data: { release: "production" } });
    expect(JSON.stringify(manifest)).not.toMatch(/127\.0\.0\.1|test-acceptance-registry-only|test-template-model-only-key/);
    noSdkRequests();
  });
});
