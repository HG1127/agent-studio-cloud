import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { expect, vi } from "vitest";
import { AgentManifest } from "@/contracts/manifest";
import { PublicToolCallResult, PublicToolManageResult } from "@/contracts/public-agent-tool";
import { WorkflowDraft, WorkflowNode } from "@/contracts/workflow";
import { WorkflowAcceptanceContext } from "@/contracts/workflow-case-acceptance";
import type { HarnessPolicySnapshot } from "@/contracts/harness-management";
import { readAcceptanceContext } from "@/db/runtime/acceptance-client-lifecycle";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { publicToolTestManifest } from "../fixtures/public-agent-tool";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

export async function executeOwnedWorkflowCase(rawContext: WorkflowAcceptanceContext): Promise<void> {
  const context = WorkflowAcceptanceContext.parse(rawContext), actual = readAcceptanceContext();
  if (!actual || Object.entries(context).some(([key, value]) => actual[key as keyof WorkflowAcceptanceContext] !== value)) {
    throw new Error("业务验收只允许在父方登记的独立执行域运行");
  }
  if (context.caseId === "public-tool-approval-idempotency") await publicToolApproval();
  else await harnessCase(context.caseId);
}

async function publicToolApproval(): Promise<void> {
  const { db } = await import("@/lib/db");
  const { agents, agentVersions, publicAgentToolCalls, runs } = await import("@/db/schema");
  const { getRun } = await import("workflow/api");
  const { callPublicToolAction, managePublicToolAction, readPublicToolCallAction } = await import("@/server/actions/public-agent-tools");
  const { decideRunApprovalAction } = await import("@/server/actions/decide-run-approval");
  const { waitForPendingApprovalHook } = await import("./approval-helpers");
  const admin = "workflow-public-tool-admin-".repeat(2);
  let agentId = "", versionId = "", toolId = "", credential = "", runId = "";
  let handle: ReturnType<typeof getRun>;
  vi.stubEnv("PUBLIC_AGENT_TOOLS_ADMIN_TOKEN", admin); vi.stubEnv("HARNESS_POLICY_JSON", ""); vi.stubEnv("HARNESS_MAX_PROMPT_CHARS", "");
  agentId = randomUUID(); versionId = randomUUID();
  const base = publicToolTestManifest(agentId);
  const manifest = AgentManifest.parse({ ...base, workflowSnapshot: { ...base.workflowSnapshot, nodes: {
    ...base.workflowSnapshot.nodes,
    record: { ...base.workflowSnapshot.nodes.record, type: "ai", system: undefined, next: "confirm",
      modelOutput: { format: "json", providerMode: "json", maxRepairAttempts: 0, mockOutput: { amount: 0, approved: false },
        schema: { type: "object", required: ["amount", "approved"], additionalProperties: false, properties: { amount: { type: "number" }, approved: { type: "boolean" } } } } },
    confirm: { id: "confirm", title: "确认成果", type: "human", approval: { role: "业务负责人", reason: "核对后才交付" }, next: "done", rejectNext: "done" },
  } } });
  await db.insert(agents).values({ id: agentId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, name: "公开工具工作流回归", intentText: "审批后交付", status: "published" });
  await db.insert(agentVersions).values({ id: versionId, agentId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, version: 1, status: "production", manifest });
  const created = PublicToolManageResult.parse(await managePublicToolAction(admin, { operation: "create", requestId: randomUUID(), name: "公开工作流工具", description: "", confirmed: true }));
  if (!created.ok) throw new Error(created.error);
  toolId = created.tool.toolId;
  const published = PublicToolManageResult.parse(await managePublicToolAction(admin, { operation: "publish", toolId, expectedRevision: 1, requestId: randomUUID(), agentId, versionId, confirmed: true }));
  if (!published.ok) throw new Error(published.error);
  const minted = PublicToolManageResult.parse(await managePublicToolAction(admin, { operation: "mint-key", toolId, expectedRevision: published.tool.revision, requestId: randomUUID(), name: "工作流回归", expiresAt: null, confirmed: true }));
  if (!minted.ok || !minted.token) throw new Error("缺少回归调用凭据");
  credential = minted.token;
  const requestId = randomUUID(), input = { requestId, input: { amount: 0, approved: false } };
  const started = PublicToolCallResult.parse(await callPublicToolAction(credential, toolId, input));
  expect(started).toMatchObject({ ok: true, call: { resultAvailable: false, deliveryConfirmed: false } });
  const [run] = await db.select().from(runs).where(and(eq(runs.agentId, agentId), eq(runs.workspaceId, DEMO_WORKSPACE_ID)));
  runId = run.id; expect(run.versionId).toBe(versionId); expect(run.workflowRunId).toBeTruthy();
  handle = getRun(run.workflowRunId!);
  const hook = await waitForPendingApprovalHook(handle, runId);
  expect(await readPublicToolCallAction(credential, { toolId, requestId })).toMatchObject({ ok: true, call: { state: "waiting_approval", result: null } });
  await callPublicToolAction(credential, toolId, input);
  expect(await db.select().from(runs).where(eq(runs.agentId, agentId))).toHaveLength(1);
  const decided = await decideRunApprovalAction({ runId, approvalId: hook.slice("approval:".length), decision: "approved", confirmed: true, note: "已核对" });
  expect(decided).toMatchObject({ ok: true }); await expect(handle.returnValue).resolves.toEqual({ status: "completed" });
  await vi.waitFor(async () => {
    expect(await readPublicToolCallAction(credential, { toolId, requestId })).toMatchObject({
      ok: true, call: { state: "completed", resultAvailable: true, deliveryConfirmed: false, result: { delivery: { amount: 0, approved: false } } },
    });
  }, { timeout: 30_000, interval: 250 });
  expect(await db.select().from(publicAgentToolCalls).where(eq(publicAgentToolCalls.toolId, toolId))).toHaveLength(1);
}

async function harnessCase(caseId: Exclude<WorkflowAcceptanceContext["caseId"], "public-tool-approval-idempotency">): Promise<void> {
  const { db } = await import("@/lib/db");
  const { runs, runSteps, traceEvents } = await import("@/db/schema");
  const { saveManagedHarnessPolicy } = await import("@/server/services/harness-policies");
  const { waitForHook } = await import("@workflow/vitest");
  const { resumeHook, start } = await import("workflow/api");
  const { harnessPolicyManagementProbeWorkflow } = await import("./harness-policy-management.workflow");
  const workspaceId = randomUUID(), createdBy = randomUUID();
  const empty = { version: 1 as const, rules: [] };
  const deny = { version: 1 as const, rules: [{ id: "deny-ai", effect: "deny" as const, when: { nodeType: "ai" as const } }] };
  const node = WorkflowNode.parse({ id: "target_ai", type: "ai", title: "规则检查目标" });
  const draft = WorkflowDraft.parse({ id: "harness-probe", startNodeId: "start", rootAgent: { id: "probe", name: "规则测试助手", role: "测试" },
    memoryPolicy: { taskContext: true, longTerm: false },
    nodes: { start: { id: "start", type: "trigger", title: "开始", next: "target_ai" }, target_ai: { ...node, next: "done" }, done: { id: "done", type: "end", title: "结束" } } });
  vi.stubEnv("HARNESS_POLICY_JSON", "");
  async function startProbe(args: Parameters<typeof harnessPolicyManagementProbeWorkflow>[0]) {
    const handle = await start(harnessPolicyManagementProbeWorkflow, [args]), returnValue = handle.returnValue;
    // 仅监听拒绝避免未处理 Promise，原 Promise 仍交由原业务断言核对。
    void returnValue.catch(() => undefined);
    return { handle, returnValue };
  }
  async function save(policy: typeof empty | typeof deny | null, expectedRevision = 0) {
    return saveManagedHarnessPolicy({ requestId: randomUUID(), expectedRevision, confirmed: true, policy, reason: "隔离实际 Workflow 验收" }, workspaceId, createdBy);
  }
  async function insertRun(overrides: Partial<typeof runs.$inferInsert> = {}) {
    const id = randomUUID();
    await db.insert(runs).values({ id, workspaceId, createdBy, agentId: randomUUID(), versionId: randomUUID(), status: "queued", ...overrides });
    return id;
  }
  async function begin(runId: string, options: { legacyGuardOnly?: boolean; injectRetry?: boolean } = {}) {
    const token = `harness-probe:${randomUUID()}`;
    const { handle, returnValue } = await startProbe({ runId, draft, node, token, ...options });
    await waitForHook(handle, { token }); return { handle, token, returnValue };
  }
  async function runSnapshot(id: string) {
    const [row] = await db.select({ snapshot: runs.harnessPolicySnapshot }).from(runs).where(and(eq(runs.id, id), eq(runs.workspaceId, workspaceId)));
    return row.snapshot;
  }
  const cases = {
    "harness-frozen-denial": async () => {
      await save(deny); const id = await insertRun(), probe = await begin(id), snapshot = await runSnapshot(id);
      expect(snapshot).toMatchObject({ revision: 1, policy: deny });
      await save(null, 1); await resumeHook(probe.token, true);
      await expect(probe.returnValue).rejects.toThrow();
      expect(await runSnapshot(id)).toEqual(snapshot);
      const steps = await db.select().from(runSteps).where(eq(runSteps.runId, id));
      expect(steps).toHaveLength(1); expect(steps[0]).toMatchObject({ status: "failed", output: null });
    },
    "harness-child-inherits": async () => {
      await save(empty); const parentId = await insertRun(), parent = await begin(parentId), snapshot = await runSnapshot(parentId);
      await save(deny, 1); const childId = await insertRun({ parentRunId: parentId, sourceType: "agent_call" }), child = await begin(childId);
      expect(await runSnapshot(childId)).toEqual(snapshot);
      await resumeHook(child.token, true); await expect(child.returnValue).resolves.toMatchObject({ guarded: true });
      await resumeHook(parent.token, true); await expect(parent.returnValue).resolves.toMatchObject({ guarded: true });
    },
    "harness-legacy-snapshot": async () => {
      await save(deny); const parentId = await insertRun({ status: "running" }), parent = await begin(parentId, { legacyGuardOnly: true });
      const childId = await insertRun({ parentRunId: parentId, sourceType: "handoff" }), child = await begin(childId);
      expect(await runSnapshot(parentId)).toBeNull(); expect(await runSnapshot(childId)).toBeNull();
      await resumeHook(child.token, true); await expect(child.returnValue).resolves.toMatchObject({ guarded: true });
      await resumeHook(parent.token, true); await expect(parent.returnValue).resolves.toMatchObject({ guarded: true });
    },
    "harness-invalid-parent": async () => {
      const foreignWorkspace = randomUUID(), foreign = randomUUID();
      await db.insert(runs).values({ id: foreign, workspaceId: foreignWorkspace, createdBy, agentId: randomUUID(), versionId: randomUUID(), status: "running" });
      for (const parentRunId of [foreign, randomUUID()]) {
        const id = await insertRun({ parentRunId, sourceType: "agent_call" });
        const { returnValue } = await startProbe({ runId: id, draft, node, token: `harness-probe:${randomUUID()}` });
        await expect(returnValue).rejects.toThrow();
        const [row] = await db.select().from(runs).where(eq(runs.id, id));
        expect(row).toMatchObject({ status: "queued", workflowRunId: null, harnessPolicySnapshot: null, startedAt: null });
      }
    },
    "harness-administrator-and-invalid-snapshot": async () => {
      await save(empty); const id = await insertRun(), probe = await begin(id);
      vi.stubEnv("HARNESS_POLICY_JSON", JSON.stringify({ version: 1, rules: [{ id: "deny", effect: "deny", when: {}, reason: "password=private-password" }] }));
      await resumeHook(probe.token, true); await expect(probe.returnValue).rejects.toThrow();
      const events = await db.select().from(traceEvents).where(eq(traceEvents.runId, id)); expect(JSON.stringify(events)).not.toContain("private-password");
      vi.stubEnv("HARNESS_POLICY_JSON", ""); const invalid = await insertRun({ status: "running", harnessPolicySnapshot: { version: 2 } as unknown as HarnessPolicySnapshot });
      const invalidProbe = await begin(invalid, { legacyGuardOnly: true });
      await resumeHook(invalidProbe.token, true); await expect(invalidProbe.returnValue).rejects.toThrow();
    },
    "harness-retry": async () => {
      await save(empty); const id = await insertRun(), probe = await begin(id, { injectRetry: true }), snapshot = await runSnapshot(id);
      await save(deny, 1); await resumeHook(probe.token, true);
      const result = await probe.returnValue; expect(result).toMatchObject({ guarded: true }); expect(result.attempt).toBeGreaterThanOrEqual(2);
      expect(await runSnapshot(id)).toEqual(snapshot);
      const steps = await db.select().from(runSteps).where(eq(runSteps.runId, id)); expect(steps).toHaveLength(1); expect(steps[0].status).toBe("succeeded");
    },
  };
  await cases[caseId]();
}
