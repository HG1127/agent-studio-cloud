import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const scope = vi.hoisted(() => ({ workspace: crypto.randomUUID(), start: vi.fn() }));
vi.mock("@/lib/constants", async (original) => ({ ...await original<typeof import("@/lib/constants")>(), DEMO_WORKSPACE_ID: scope.workspace }));
vi.mock("workflow/api", () => ({ start: scope.start }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { AgentManifest } from "@/contracts/manifest";
import { PublicToolCallResult, PublicToolManageResult } from "@/contracts/public-agent-tool";
import { agentVersions, agents, publicAgentTools, publicAgentToolKeys, publicAgentToolCalls, publicAgentToolChanges, runs } from "@/db/schema";
import { DEMO_USER_ID } from "@/lib/constants";
import { publicToolHash, publicToolSourceKey } from "@/server/domain/public-agent-tool";
import { publicToolTestManifest } from "../fixtures/public-agent-tool";

const admin = "integration-admin-".repeat(3), input = { amount: 0, approved: false };
let agentId = "", versionId = "", toolId = "", keyId = "", credential = "", revision = 0;
let db: typeof import("@/lib/db").db;
let callPublicToolAction: typeof import("@/server/actions/public-agent-tools").callPublicToolAction;
let managePublicToolAction: typeof import("@/server/actions/public-agent-tools").managePublicToolAction;
let readPublicToolCallAction: typeof import("@/server/actions/public-agent-tools").readPublicToolCallAction;
let authorizePublicTool: typeof import("@/server/queries/public-agent-tools").authorizePublicTool;
let isolatedDbAccepted = false, servicesReady = false;
function isolationGuard() { if (process.env.MVP_ACCEPTANCE_ISOLATED_DB !== "1") throw new Error("公开工具回归仅允许 CI 临时隔离数据库"); }
beforeAll(async () => {
  isolationGuard();
  isolatedDbAccepted = true;
  const [database, actions, queries] = await Promise.all([
    import("@/lib/db"), import("@/server/actions/public-agent-tools"), import("@/server/queries/public-agent-tools"),
  ]);
  db = database.db;
  callPublicToolAction = actions.callPublicToolAction;
  managePublicToolAction = actions.managePublicToolAction;
  readPublicToolCallAction = actions.readPublicToolCallAction;
  authorizePublicTool = queries.authorizePublicTool;
  servicesReady = true;
});
beforeEach(async () => {
  isolationGuard();
  if (!isolatedDbAccepted || !servicesReady) throw new Error("隔离数据库服务尚未安全加载");
  vi.stubEnv("PUBLIC_AGENT_TOOLS_ADMIN_TOKEN", admin);
  scope.start.mockReset().mockImplementation(async () => ({ runId: "wrun_public_tool_" + randomUUID(), cancel: vi.fn() }));
  agentId = randomUUID(); versionId = randomUUID();
  await db.insert(agents).values({ id: agentId, workspaceId: scope.workspace, createdBy: DEMO_USER_ID, name: "公开工具回归", intentText: "测试公开工具冻结和防重" });
  await db.insert(agentVersions).values({ id: versionId, agentId, workspaceId: scope.workspace, createdBy: DEMO_USER_ID, version: 1, status: "production", manifest: publicToolTestManifest(agentId) });
  const created = PublicToolManageResult.parse(await managePublicToolAction(admin, { operation: "create", requestId: randomUUID(), confirmed: true, name: "公开工具回归", description: "" }));
  if (!created.ok) throw new Error(created.error);
  toolId = created.tool.toolId; revision = created.tool.revision;
  await manage({ operation: "publish", agentId, versionId });
  const minted = await manage({ operation: "mint-key", name: "回归调用方", expiresAt: null });
  if (!minted.ok || !minted.token || !minted.key) throw new Error("未取得测试密钥");
  credential = minted.token; keyId = minted.key.keyId;
});
afterEach(async () => {
  if (!isolatedDbAccepted || !servicesReady) { vi.unstubAllEnvs(); return; }
  isolationGuard();
  await db.delete(publicAgentToolCalls).where(eq(publicAgentToolCalls.workspaceId, scope.workspace));
  await db.delete(publicAgentToolChanges).where(eq(publicAgentToolChanges.workspaceId, scope.workspace));
  await db.delete(publicAgentToolKeys).where(eq(publicAgentToolKeys.workspaceId, scope.workspace));
  await db.delete(publicAgentTools).where(eq(publicAgentTools.workspaceId, scope.workspace));
  await db.delete(runs).where(eq(runs.workspaceId, scope.workspace));
  if (agentId) {
    await db.delete(agentVersions).where(eq(agentVersions.agentId, agentId));
    await db.delete(agents).where(eq(agents.id, agentId));
  }
  agentId = versionId = toolId = keyId = credential = ""; revision = 0; vi.unstubAllEnvs();
});
type Command = { operation: "publish"; agentId: string; versionId: string } | { operation: "disable" } | { operation: "mint-key"; name: string; expiresAt: string | null } | { operation: "revoke-key"; keyId: string };
async function manage(command: Command, requestId = randomUUID()) {
  const result = PublicToolManageResult.parse(await managePublicToolAction(admin, { ...command, toolId, expectedRevision: revision, requestId, confirmed: true }));
  if (result.ok) revision = result.tool.revision;
  return result;
}
async function invoke(requestId = randomUUID(), payload = input, token = credential) {
  return PublicToolCallResult.parse(await callPublicToolAction(token, toolId, { requestId, input: payload }));
}
describe("公开助手工具真实数据库隔离回归", () => {
  it("同请求并发仅一条运行，改变输入冲突，普通页面来源键无法相撞", async () => {
    const requestId = randomUUID(), results = await Promise.all([invoke(requestId), invoke(requestId)]);
    expect(results.every((value) => value.ok)).toBe(true);
    expect(scope.start).toHaveBeenCalledOnce();
    const rows = await db.select().from(runs).where(eq(runs.workspaceId, scope.workspace));
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ sourceType: "manual", sourceKey: publicToolSourceKey(toolId, requestId), versionId });
    expect(await invoke(requestId, { ...input, amount: 1 })).toMatchObject({ ok: false, code: "conflict" });
    expect(await db.select().from(publicAgentToolCalls).where(eq(publicAgentToolCalls.workspaceId, scope.workspace))).toHaveLength(1);
  });
  it("原已发布版本退休仍绑定原版，工具重新发布和凭据轮换不改变旧请求", async () => {
    const requestId = randomUUID(); await invoke(requestId);
    const nextId = randomUUID(), nextManifest = AgentManifest.parse({ ...publicToolTestManifest(agentId), workflowFingerprint: "new-version" });
    await db.update(agentVersions).set({ status: "retired" }).where(eq(agentVersions.id, versionId));
    await db.insert(agentVersions).values({ id: nextId, agentId, workspaceId: scope.workspace, createdBy: DEMO_USER_ID, version: 2, status: "production", manifest: nextManifest });
    await invoke();
    const original = await db.select().from(runs).where(eq(runs.workspaceId, scope.workspace));
    expect(original.every((row) => row.versionId === versionId)).toBe(true);
    await manage({ operation: "publish", agentId, versionId: nextId });
    const minted = await manage({ operation: "mint-key", name: "轮换调用方", expiresAt: null });
    if (!minted.ok || !minted.token) throw new Error("未取得替代凭据");
    expect(await invoke(requestId, input, minted.token)).toMatchObject({ ok: true, call: { version: 1 } });
    const fresh = await invoke(); expect(fresh).toMatchObject({ ok: true, call: { version: 2 } });
    expect(scope.start).toHaveBeenCalledTimes(3);
  });
  it("调用密钥入库仅哈希，同管理请求回放没有明文，撤销和停用拒绝后续访问", async () => {
    const [key] = await db.select().from(publicAgentToolKeys).where(eq(publicAgentToolKeys.id, keyId));
    expect(key.tokenHash).toBe(publicToolHash(credential)); expect(JSON.stringify(key)).not.toContain(credential);
    const requestId = randomUUID(), expectedRevision = revision;
    const command = { operation: "mint-key" as const, toolId, expectedRevision, requestId, confirmed: true as const, name: "仅一次", expiresAt: null };
    const first = await managePublicToolAction(admin, command), replay = await managePublicToolAction(admin, command);
    expect(first).toHaveProperty("token"); expect(replay).not.toHaveProperty("token");
    if (replay.ok) revision = replay.tool.revision;
    await manage({ operation: "revoke-key", keyId });
    expect(await authorizePublicTool(credential, toolId)).toBeNull();
    expect(await invoke()).toMatchObject({ ok: false, code: "unauthorized" });
    const other = await manage({ operation: "mint-key", name: "备用", expiresAt: null });
    if (!other.ok || !other.token) throw new Error("缺少备用凭据");
    await manage({ operation: "disable" });
    expect(await invoke(randomUUID(), input, other.token)).toMatchObject({ code: "unauthorized" });
    expect(await readPublicToolCallAction(other.token, { toolId, requestId: randomUUID() })).toMatchObject({ code: "unauthorized" });
  });
  it("候选、工作区外和冻结内容改变均拒绝，不跳到最新", async () => {
    await db.update(agentVersions).set({ status: "candidate" }).where(eq(agentVersions.id, versionId));
    expect(await manage({ operation: "publish", agentId, versionId })).toMatchObject({ code: "invalid" });
    expect(await invoke()).toMatchObject({ code: "conflict" });
    await db.update(agentVersions).set({ status: "production", workspaceId: randomUUID() }).where(eq(agentVersions.id, versionId));
    expect(await invoke()).toMatchObject({ code: "conflict" });
    await db.update(agentVersions).set({ workspaceId: scope.workspace, manifest: { ...publicToolTestManifest(agentId), workflowFingerprint: "mutated" } }).where(eq(agentVersions.id, versionId));
    expect(await invoke()).toMatchObject({ code: "conflict" }); expect(scope.start).not.toHaveBeenCalled();
  });
  it("SDK 启动响应未知保留同一已接收任务，失败和未知状态不返回成果", async () => {
    scope.start.mockRejectedValueOnce(new Error("模拟平台响应丢失"));
    const requestId = randomUUID(), result = await invoke(requestId);
    expect(result).toMatchObject({ ok: true, call: { resultAvailable: false, result: null, deliveryConfirmed: false } });
    await invoke(requestId); expect(scope.start).toHaveBeenCalledOnce();
    const [run] = await db.select().from(runs).where(and(eq(runs.workspaceId, scope.workspace), eq(runs.sourceKey, publicToolSourceKey(toolId, requestId))));
    for (const status of ["failed", "unrecognized"]) {
      await db.update(runs).set({ status, result: { private: "process-only" } }).where(eq(runs.id, run.id));
      expect(await readPublicToolCallAction(credential, { toolId, requestId })).toMatchObject({ ok: true, call: { resultAvailable: false, result: null } });
    }
  });
});
