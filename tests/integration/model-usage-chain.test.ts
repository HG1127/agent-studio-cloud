import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/runs/[runId]/usage/chain/route";
import { RunModelUsageChainResult, MAX_MODEL_USAGE_CHAIN_DEPTH, MAX_MODEL_USAGE_CHAIN_RUNS } from "@/contracts/model-usage-chain";
import { runs } from "@/db/schema";
import { db } from "@/lib/db";
import { DEMO_USER_ID, DEMO_WORKSPACE_ID } from "@/lib/constants";
import { readReportedModelUsage } from "@/server/domain/model-usage";
import { getRunModelUsageChain } from "@/server/queries/model-usage-chain";
import { beginRunModelCall, settleRunModelCall } from "@/server/services/model-call";
const owned: string[] = [], workspace = randomUUID(), now = new Date("2026-10-09T12:00:00Z");
afterEach(async () => { if (owned.length) await db.delete(runs).where(inArray(runs.id, owned)); owned.length = 0; });
function values(id: string, overrides: Partial<typeof runs.$inferInsert> = {}) {
  return { id, workspaceId: workspace, createdBy: DEMO_USER_ID, agentId: randomUUID(), versionId: randomUUID(), status: "running", input: {}, modelUsageTrackingVersion: "v1", collaborationTrackingVersion: "v1", ...overrides };
}
async function fixture(parent: string | null = null, overrides: Partial<typeof runs.$inferInsert> = {}) {
  const id = randomUUID(); owned.push(id);
  await db.insert(runs).values(values(id, { parentRunId: parent, ...(parent ? { sourceType: "agent_call", sourceKey: `agent-call:${parent}:${id}` } : {}), ...overrides })); return id;
}
async function usage(id: string, inputTokens = 12, outputTokens = 6) {
  const identity = await beginRunModelCall({ runId: id, nodeId: "work", nodeTitle: "业务处理", modelId: "test", connectionId: null });
  await settleRunModelCall({ ...identity, state: "returned", measurement: readReportedModelUsage({ inputTokens: { total: inputTokens }, outputTokens: { total: outputTokens } }), failure: null });
}
describe("执行链用量真实数据库验收", () => {
  it("从子运行找到根、兄弟与后代，失败取消也计实际用量，不重复纳入", async () => {
    const root = await fixture(), child = await fixture(root), sibling = await fixture(root, { sourceType: "handoff", sourceKey: `handoff:${root}:sibling` }), grandchild = await fixture(child);
    await usage(root); await usage(child, 20, 10); await usage(grandchild, 4, 2);
    await db.update(runs).set({ status: "completed" }).where(inArray(runs.id, [root, child]));
    await db.update(runs).set({ status: "cancelled" }).where(eq(runs.id, sibling)); await db.update(runs).set({ status: "failed" }).where(eq(runs.id, grandchild));
    const result = await getRunModelUsageChain(workspace, child, now);
    expect(result).toMatchObject({ requestedRunId: child, rootRunId: root, graph: { includedRuns: 4, complete: true, cycleDetected: false }, execution: { finishedRuns: 4, liveRuns: 0, isFinalSnapshot: true }, calls: { total: 3, returned: 3 }, usage: { knownInputTokens: 36, knownOutputTokens: 18, knownCallTotalTokens: 54, recordedUsageComplete: true } });
    expect(new Set(result!.runs.map((run) => run.summary.runId)).size).toBe(4);
    expect(result!.runs.find((run) => run.summary.runId === grandchild)).toMatchObject({ parentRunId: child, depth: 2 });
  });
  it("任务全已结束仍保留未确认及失败调用，不把终态快照当完整用量", async () => {
    const root = await fixture(), child = await fixture(root);
    await beginRunModelCall({ runId: root, nodeId: "work", nodeTitle: "未确认调用", modelId: "test", connectionId: null });
    const identity = await beginRunModelCall({ runId: child, nodeId: "work", nodeTitle: "失败调用", modelId: "test", connectionId: null });
    await settleRunModelCall({ ...identity, state: "failed", measurement: null, failure: "provider-unavailable" });
    await db.update(runs).set({ status: "completed" }).where(eq(runs.id, root));
    await db.update(runs).set({ status: "failed" }).where(eq(runs.id, child));
    expect(await getRunModelUsageChain(workspace, root, now)).toMatchObject({
      graph: { complete: true }, execution: { finishedRuns: 2, isFinalSnapshot: true },
      calls: { total: 2, pending: 1, failed: 1, returned: 0 },
      usage: { incompleteCalls: 2, knownInputTokens: null, knownOutputTokens: null, knownCallTotalTokens: null, recordedUsageComplete: false },
    });
  });

  it("历史来源键大小写兼容，但不回填关系覆盖或虚报完整用量", async () => {
    const root = await fixture(null, { collaborationTrackingVersion: null });
    const child = await fixture(null, { sourceType: "agent_call", sourceKey: `agent-call:${root.toUpperCase()}:legacy`, collaborationTrackingVersion: null, modelUsageTrackingVersion: null });
    await usage(child);
    const result = await getRunModelUsageChain(workspace, root, now);
    expect(result).toMatchObject({ graph: { includedRuns: 2, legacyRelationRuns: 1, untrackedRelationRuns: 2, untrackedModelRuns: 1, complete: false }, usage: { knownCallTotalTokens: 18, recordedUsageComplete: false } });
    const [unchanged] = await db.select().from(runs).where(eq(runs.id, child)); expect(unchanged.parentRunId).toBeNull(); expect(unchanged.collaborationTrackingVersion).toBeNull();
  });
  it("其他工作区祖先和后代不串入、不泄露标识，失去祖先明确标记", async () => {
    const foreign = await fixture(null, { workspaceId: randomUUID() }), local = await fixture(foreign);
    const orphan = await getRunModelUsageChain(workspace, local, now);
    expect(orphan).toMatchObject({ requestedRunId: local, anchorRunId: local, rootRunId: null, graph: { includedRuns: 1, missingParent: true, complete: false } });
    expect(JSON.stringify(orphan)).not.toContain(foreign); expect(await getRunModelUsageChain(workspace, foreign, now)).toBeNull();
    const root = await fixture(); await fixture(root, { workspaceId: randomUUID() });
    expect(await getRunModelUsageChain(workspace, root, now)).toMatchObject({ graph: { includedRuns: 1 } });
  });
  it("来源与显式关系冲突、未知状态都不声称关系或账本完整", async () => {
    const root = await fixture(), child = await fixture(root, { sourceKey: `agent-call:${randomUUID()}:bad`, status: "legacy-unknown" });
    const result = await getRunModelUsageChain(workspace, root, now);
    expect(result).toMatchObject({ graph: { includedRuns: 2, invalidRelationRuns: 1, unknownStatusRuns: 1, complete: false }, usage: { recordedUsageComplete: false }, execution: { isFinalSnapshot: false } });
    expect(result!.runs.find((run) => run.summary.runId === child)?.status).toBe("unknown");
  });
  it("关系环有界结束且只纳入一次，不把任一节点伪称真正根", async () => {
    const a = await fixture(), b = await fixture(a);
    await db.update(runs).set({ parentRunId: b, sourceType: "handoff", sourceKey: `handoff:${b}:cycle` }).where(eq(runs.id, a));
    const result = await getRunModelUsageChain(workspace, a, now);
    expect(result).toMatchObject({ rootRunId: null, graph: { includedRuns: 2, cycleDetected: true, complete: false }, usage: { recordedUsageComplete: false } });
    expect(new Set(result!.runs.map((run) => run.summary.runId)).size).toBe(2);
  });
  it("宽分支超过上限保留请求路径，纳入量有界且截断不伪报零", async () => {
    const root = await fixture(), requested = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const ids = Array.from({ length: MAX_MODEL_USAGE_CHAIN_RUNS + 1 }, (_, index) => `10000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`);
    ids.push(requested); owned.push(...ids);
    await db.insert(runs).values(ids.map((id) => values(id, { parentRunId: root, sourceType: "agent_call", sourceKey: `agent-call:${root}:${id}` })));
    const result = await getRunModelUsageChain(workspace, requested, now);
    expect(result).toMatchObject({ rootRunId: root, graph: { includedRuns: MAX_MODEL_USAGE_CHAIN_RUNS, truncated: true, complete: false }, usage: { recordedUsageComplete: false, knownCallTotalTokens: null } });
    expect(result!.runs.some((run) => run.summary.runId === requested)).toBe(true);
  });
  it("深度边界探测后代并明确截断，从深节点查询仍保留原运行", async () => {
    const root = await fixture(); let last = root;
    for (let depth = 0; depth < MAX_MODEL_USAGE_CHAIN_DEPTH + 2; depth += 1) last = await fixture(last);
    expect(await getRunModelUsageChain(workspace, root, now)).toMatchObject({ graph: { includedRuns: MAX_MODEL_USAGE_CHAIN_DEPTH + 1, truncated: true, complete: false } });
    const fromDeep = await getRunModelUsageChain(workspace, last, now);
    expect(fromDeep).toMatchObject({ requestedRunId: last, rootRunId: null, graph: { truncated: true, complete: false } }); expect(fromDeep!.runs.some((run) => run.summary.runId === last)).toBe(true);
  });
  it("真实接口只读元数据，不返回正文、来源键、引擎句柄或其他工作区", async () => {
    const root = await fixture(null, { workspaceId: DEMO_WORKSPACE_ID, input: { private: "private-chain-input" }, workflowRunId: "private-engine-handle" });
    await fixture(root, { workspaceId: DEMO_WORKSPACE_ID, sourceKey: `agent-call:${root}:private-source-key` });
    const [before] = await db.select().from(runs).where(eq(runs.id, root));
    const response = await GET(new Request(`http://localhost/api/runs/${root}/usage/chain`), { params: Promise.resolve({ runId: root }) });
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store"); const body = await response.json();
    expect(RunModelUsageChainResult.parse(body)).toMatchObject({ ok: true, summary: { graph: { includedRuns: 2 } } }); expect(JSON.stringify(body)).not.toMatch(/private-chain|private-source|private-engine|sourceKey|workspaceId/);
    const [after] = await db.select().from(runs).where(eq(runs.id, root)); expect(after).toEqual(before);
    const foreign = await fixture(); expect((await GET(new Request(`http://localhost/api/runs/${foreign}/usage/chain`), { params: Promise.resolve({ runId: foreign }) })).status).toBe(404);
  });
  it("各运行有效数值累计溢出明确拒绝，接口不会返回截断费用", async () => {
    const root = await fixture(null, { workspaceId: DEMO_WORKSPACE_ID }), child = await fixture(root, { workspaceId: DEMO_WORKSPACE_ID });
    await usage(root, Number.MAX_SAFE_INTEGER, 0); await usage(child, 1, 0);
    await expect(getRunModelUsageChain(DEMO_WORKSPACE_ID, root, now)).rejects.toThrow("安全数值范围");
    const response = await GET(new Request(`http://localhost/api/runs/${root}/usage/chain`), { params: Promise.resolve({ runId: root }) }); expect(response.status).toBe(503); expect(response.headers.get("retry-after")).toBe("2");
  });
});
