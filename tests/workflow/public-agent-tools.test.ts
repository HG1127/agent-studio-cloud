import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentManifest } from "@/contracts/manifest";
import { PublicToolCallResult, PublicToolManageResult } from "@/contracts/public-agent-tool";
import { agents, agentVersions, publicAgentTools, publicAgentToolCalls, publicAgentToolChanges, publicAgentToolKeys, runs } from "@/db/schema";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { publicToolTestManifest } from "../fixtures/public-agent-tool";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const admin = "workflow-public-tool-admin-".repeat(2);
let agentId = "", versionId = "", toolId = "", credential = "", runId = "";
let db: typeof import("@/lib/db").db;
let getRun: typeof import("workflow/api").getRun;
let callPublicToolAction: typeof import("@/server/actions/public-agent-tools").callPublicToolAction;
let managePublicToolAction: typeof import("@/server/actions/public-agent-tools").managePublicToolAction;
let readPublicToolCallAction: typeof import("@/server/actions/public-agent-tools").readPublicToolCallAction;
let decideRunApprovalAction: typeof import("@/server/actions/decide-run-approval").decideRunApprovalAction;
let waitForPendingApprovalHook: typeof import("./approval-helpers").waitForPendingApprovalHook;
let handle: ReturnType<typeof import("workflow/api").getRun> | undefined;
let isolatedDbAccepted = false, servicesReady = false, cleanupStarted = false;
let sdkStartAttempted = false, naturallyCompleted = false, requestsInFlight = 0;
function isolationGuard() { if (process.env.MVP_ACCEPTANCE_ISOLATED_DB !== "1") throw new Error("公开工具 Workflow 回归仅允许 CI 临时隔离库"); }
beforeAll(async () => {
  isolationGuard();
  isolatedDbAccepted = true;
  const [database, sdk, actions, decisions, approvalHelpers] = await Promise.all([
    import("@/lib/db"), import("workflow/api"), import("@/server/actions/public-agent-tools"),
    import("@/server/actions/decide-run-approval"), import("./approval-helpers"),
  ]);
  db = database.db;
  getRun = sdk.getRun;
  callPublicToolAction = actions.callPublicToolAction;
  managePublicToolAction = actions.managePublicToolAction;
  readPublicToolCallAction = actions.readPublicToolCallAction;
  decideRunApprovalAction = decisions.decideRunApprovalAction;
  waitForPendingApprovalHook = approvalHelpers.waitForPendingApprovalHook;
  servicesReady = true;
});
function requireOpenTestPhase() {
  if (cleanupStarted) throw new Error("本批测试已开始清理，禁止继续发起请求");
}
async function boundedCleanupOperation<T>(operation: () => Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("本批 SDK 清理观察已超时");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("本批 SDK 清理观察已超时")), remaining);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
async function preserveStartedWorkflowRecords(): Promise<never> {
  const deadline = Date.now() + 3000;
  let sdkStatus: string | null = null;
  if (handle) {
    try { sdkStatus = await boundedCleanupOperation(() => handle!.status, deadline); } catch { /* 未确认就保留，不把读取失败当终止。 */ }
    if (!sdkStatus || !["completed", "failed", "cancelled"].includes(sdkStatus)) {
      try { await boundedCleanupOperation(() => handle!.cancel(), deadline); } catch { /* 取消回执也不能证明生产者退出。 */ }
    }
  }
  const reason = naturallyCompleted && sdkStatus === "completed" && requestsInFlight === 0
    ? "本批根任务已自然完成，但 SDK4 不能核对全部在途生产者已退出"
    : "本批请求、SDK 任务或启动句柄尚未确认停止";
  throw new Error(reason + "，保留本批数据库记录并阻断自动清理");
}
afterEach(async () => {
  cleanupStarted = true;
  if (!isolatedDbAccepted || !servicesReady) { vi.unstubAllEnvs(); return; }
  isolationGuard();
  try {
    if (sdkStartAttempted || handle || requestsInFlight > 0) await preserveStartedWorkflowRecords();
    if (agentId) {
      const owned = await db.select({ id: runs.id }).from(runs).where(and(eq(runs.agentId, agentId), eq(runs.workspaceId, DEMO_WORKSPACE_ID)));
      if (owned.length > 0) throw new Error("本批出现未登记的运行，保留记录并阻断清理");
      if (toolId) {
        await db.delete(publicAgentToolCalls).where(and(eq(publicAgentToolCalls.toolId, toolId), eq(publicAgentToolCalls.workspaceId, DEMO_WORKSPACE_ID)));
        await db.delete(publicAgentToolChanges).where(and(eq(publicAgentToolChanges.toolId, toolId), eq(publicAgentToolChanges.workspaceId, DEMO_WORKSPACE_ID)));
        await db.delete(publicAgentToolKeys).where(and(eq(publicAgentToolKeys.toolId, toolId), eq(publicAgentToolKeys.workspaceId, DEMO_WORKSPACE_ID)));
        await db.delete(publicAgentTools).where(and(eq(publicAgentTools.id, toolId), eq(publicAgentTools.workspaceId, DEMO_WORKSPACE_ID)));
      }
      await db.delete(agentVersions).where(and(eq(agentVersions.agentId, agentId), eq(agentVersions.workspaceId, DEMO_WORKSPACE_ID)));
      await db.delete(agents).where(and(eq(agents.id, agentId), eq(agents.workspaceId, DEMO_WORKSPACE_ID)));
    }
    agentId = versionId = toolId = credential = runId = ""; handle = undefined;
  } finally { if (requestsInFlight === 0) vi.unstubAllEnvs(); }
});
describe("公开工具到真实持久 Workflow 暂停与恢复", () => {
  it("审批期间同请求不重复启动，恢复后只交付原冻结字段，不宣称结果已送达", async () => {
    isolationGuard();
    if (!isolatedDbAccepted || !servicesReady) throw new Error("隔离数据库服务尚未安全加载");
    requestsInFlight += 1;
    try {
      requireOpenTestPhase();
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
      requireOpenTestPhase();
      await db.insert(agentVersions).values({ id: versionId, agentId, workspaceId: DEMO_WORKSPACE_ID, createdBy: DEMO_USER_ID, version: 1, status: "production", manifest });
      requireOpenTestPhase();
      const created = PublicToolManageResult.parse(await managePublicToolAction(admin, { operation: "create", requestId: randomUUID(), name: "公开工作流工具", description: "", confirmed: true }));
      if (!created.ok) throw new Error(created.error);
      toolId = created.tool.toolId;
      requireOpenTestPhase();
      const published = PublicToolManageResult.parse(await managePublicToolAction(admin, { operation: "publish", toolId, expectedRevision: 1, requestId: randomUUID(), agentId, versionId, confirmed: true }));
      if (!published.ok) throw new Error(published.error);
      requireOpenTestPhase();
      const minted = PublicToolManageResult.parse(await managePublicToolAction(admin, { operation: "mint-key", toolId, expectedRevision: published.tool.revision, requestId: randomUUID(), name: "工作流回归", expiresAt: null, confirmed: true }));
      if (!minted.ok || !minted.token) throw new Error("缺少回归调用凭据");
      credential = minted.token;
      const requestId = randomUUID(), input = { requestId, input: { amount: 0, approved: false } };
      requireOpenTestPhase();
      sdkStartAttempted = true;
      const started = PublicToolCallResult.parse(await callPublicToolAction(credential, toolId, input));
      expect(started).toMatchObject({ ok: true, call: { resultAvailable: false, deliveryConfirmed: false } });
      const [run] = await db.select().from(runs).where(and(eq(runs.agentId, agentId), eq(runs.workspaceId, DEMO_WORKSPACE_ID)));
      runId = run.id; expect(run.versionId).toBe(versionId); expect(run.workflowRunId).toBeTruthy();
      handle = getRun(run.workflowRunId!);
      const hook = await waitForPendingApprovalHook(handle, runId);
      expect(await readPublicToolCallAction(credential, { toolId, requestId })).toMatchObject({ ok: true, call: { state: "waiting_approval", result: null } });
      requireOpenTestPhase();
      await callPublicToolAction(credential, toolId, input);
      expect(await db.select().from(runs).where(eq(runs.agentId, agentId))).toHaveLength(1);
      requireOpenTestPhase();
      const decided = await decideRunApprovalAction({ runId, approvalId: hook.slice("approval:".length), decision: "approved", confirmed: true, note: "已核对" });
      expect(decided).toMatchObject({ ok: true }); await expect(handle.returnValue).resolves.toEqual({ status: "completed" });
      naturallyCompleted = true;
      await vi.waitFor(async () => {
        expect(await readPublicToolCallAction(credential, { toolId, requestId })).toMatchObject({
          ok: true, call: { state: "completed", resultAvailable: true, deliveryConfirmed: false, result: { delivery: { amount: 0, approved: false } } },
        });
      }, { timeout: 30_000, interval: 250 });
      expect(await db.select().from(publicAgentToolCalls).where(eq(publicAgentToolCalls.toolId, toolId))).toHaveLength(1);
    } finally { requestsInFlight -= 1; }
  });
});
