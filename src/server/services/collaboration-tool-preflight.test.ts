import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentManifest } from "@/contracts/manifest";
import { DEMO_WORKSPACE_ID } from "@/lib/constants";
import type { ToolRegistration } from "@/server/tools/tool-registry";

const mocks = vi.hoisted(() => ({
  reads: [] as unknown[][], transactionCalls: 0, updateValues: [] as Record<string, unknown>[],
  insert: vi.fn(), update: vi.fn(), lookup: vi.fn(), start: vi.fn(), lock: vi.fn(), reserve: vi.fn(), evaluation: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("@/lib/db", () => {
  const select = () => {
    let rows: unknown[] | undefined;
    const read = () => {
      if (rows !== undefined) return rows;
      rows = mocks.reads.shift();
      if (rows === undefined) throw new Error("不允许额外数据库读取");
      return rows;
    };
    const query = {
      from: () => query, innerJoin: () => query, leftJoin: () => query, where: () => query, orderBy: () => query, for: () => query,
      limit: async () => read(),
      then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve().then(read).then(resolve, reject),
    };
    return query;
  };
  const tx = { select, insert: mocks.insert, update: mocks.update };
  return { db: { ...tx, transaction: async (callback: (value: typeof tx) => unknown) => { mocks.transactionCalls += 1; return callback(tx); } } };
});
vi.mock("workflow/api", () => ({ start: mocks.start }));
vi.mock("@/server/workflows/agent-run", () => ({ agentRunWorkflow: vi.fn() }));
vi.mock("@/server/tools/tool-registry", () => ({ getToolRegistration: mocks.lookup }));
vi.mock("@/server/services/evaluation-state", () => ({ completeEvaluationForRun: mocks.evaluation }));
vi.mock("@/server/actions/revalidate-paths", () => ({ revalidatePathsAfterCommit: mocks.revalidate }));
vi.mock("@/server/services/execution-resources", () => ({
  ExecutionResourceRejected: class extends Error {}, lockExecutionWorkspace: mocks.lock, reserveRootExecutionResources: mocks.reserve,
}));
vi.mock("@/lib/model", () => ({ realModelsEnabled: () => false, resolvePublishModel: () => ({ ok: true, modelId: "mock", mock: true }) }));
vi.mock("@/server/domain/audit", () => ({ auditWorkflow: () => ({
  issues: [], counts: { critical: 0, warning: 0, info: 0 }, requirementCoverage: {}, complexityProfile: {},
}) }));

import { publishVersionAction } from "@/server/actions/publish-version";
import { resumeQueuedRunStartCore, startRunCore } from "./start-run-core";

const ROOT = "00000000-0000-4000-8000-000000000101", CHILD = "00000000-0000-4000-8000-000000000102";
const ROOT_VERSION = "00000000-0000-4000-8000-000000000103", CHILD_VERSION = "00000000-0000-4000-8000-000000000104";
const RUN_ID = "00000000-0000-4000-8000-000000000105", OLD = new Date("2000-01-01T00:00:00.000Z");
const registration: ToolRegistration = { id: "records.lookup", name: "业务查询", description: "", endpoint: "https://fixture.example/mcp", method: "POST", headers: {},
  protocol: "mcp-streamable-http", operationKind: "read", action: "lookup", scope: "records.read", risk: "low", inputSchema: { type: "object" }, outputSchema: { type: "object" } };
function manifest(agentId: string, child: boolean): AgentManifest {
  const work = child
    ? { id: "work", type: "tool", title: "查询记录", next: "done", tool: { connector: registration.name, registryToolId: registration.id,
      protocol: registration.protocol, operationKind: registration.operationKind, action: registration.action, scope: registration.scope, risk: registration.risk,
      inputSchema: registration.inputSchema, outputSchema: registration.outputSchema } }
    : { id: "work", type: "agent_call", title: "交给协作助手", next: "done", agentCall: { targetAgentId: CHILD, versionId: CHILD_VERSION } };
  return AgentManifest.parse({ schemaVersion: "4.0", workflowFingerprint: "a".repeat(64), inputContract: { fields: [] }, outputContract: { fields: [] }, knowledgeSnapshot: [],
    resourceSelection: { model: { modelId: "mock", mock: true, connectionId: null } }, designAudit: { status: "passed", issueCount: 0, criticalCount: 0 },
    workflowSnapshot: { id: "workflow", startNodeId: "start", rootAgent: { id: agentId, name: "助手", role: "查询" }, memoryPolicy: { taskContext: true, longTerm: false }, nodes: {
      start: { id: "start", type: "trigger", title: "开始", next: "work" }, work, done: { id: "done", type: "end", title: "结束", next: null },
    } },
  });
}
const rootManifest = manifest(ROOT, false), childManifest = manifest(CHILD, true);
const agent = { id: ROOT, name: "主助手", workspaceId: DEMO_WORKSPACE_ID, archivedAt: null, updatedAt: OLD };
const rootVersion = { id: ROOT_VERSION, status: "production", manifest: rootManifest };
const dependency = { agentId: CHILD, versionId: CHILD_VERSION, agentName: "协作查询助手", status: "retired", agentArchivedAt: null, manifest: childManifest };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reads = []; mocks.transactionCalls = 0; mocks.updateValues = [];
  mocks.lookup.mockReset().mockReturnValue(null);
  mocks.insert.mockReset().mockImplementation(() => { throw new Error("不允许新增数据库记录"); });
  mocks.reserve.mockReset().mockImplementation(() => { throw new Error("不允许预留执行资源"); });
  mocks.update.mockReset().mockImplementation(() => ({ set: (values: Record<string, unknown>) => ({ where: () => ({ returning: async () => {
    mocks.updateValues.push(values); return [{ id: RUN_ID }];
  } }) }) }));
});

describe("协作工具预检实际服务接线（数据库与引擎替身，不是真实Workflow验收）", () => {
  it("主任务启动前拒绝协作工具缺失，不创建运行、不预留资源、不启动引擎", async () => {
    mocks.reads = [[agent], [rootVersion], [dependency]];
    await expect(startRunCore({ agentId: ROOT, input: {} })).resolves.toEqual({ ok: false, error: expect.stringContaining("未在服务端配置") });
    expect(mocks.reads).toEqual([]); expect(mocks.transactionCalls).toBe(0);
    expect(mocks.insert).not.toHaveBeenCalled(); expect(mocks.reserve).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
  });

  it("预检后到事务前协作工具配置变化时，再次拒绝且不创建运行或预留资源", async () => {
    mocks.reads = [[agent], [rootVersion], [dependency], [{ manifest: childManifest }], [dependency]];
    mocks.lookup.mockReturnValueOnce(registration).mockReturnValue(null);
    await expect(startRunCore({ agentId: ROOT, input: {} })).resolves.toEqual({ ok: false, error: expect.stringContaining("未在服务端配置") });
    expect(mocks.reads).toEqual([]); expect(mocks.transactionCalls).toBe(1); expect(mocks.lock).toHaveBeenCalledWith(expect.anything(), DEMO_WORKSPACE_ID);
    expect(mocks.lookup).toHaveBeenCalledTimes(2); expect(mocks.insert).not.toHaveBeenCalled(); expect(mocks.reserve).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
  });

  it("发布使用相同协作工具规则，缺失时不新增版本或写入操作记录", async () => {
    mocks.reads = [[agent], [{ id: ROOT_VERSION, draft: rootManifest.workflowSnapshot, updatedAt: OLD }], [dependency]];
    await expect(publishVersionAction(ROOT)).resolves.toMatchObject({ ok: false, error: expect.stringContaining("未在服务端配置"), issues: [] });
    expect(mocks.reads).toEqual([]); expect(mocks.transactionCalls).toBe(1);
    expect(mocks.insert).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.revalidate).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
  });

  it("恢复待启动主任务也检查协作工具，持有原领取权安全结束，不另开引擎", async () => {
    mocks.reads = [[{ id: RUN_ID, agentId: ROOT, workspaceId: DEMO_WORKSPACE_ID, input: {}, stepStates: {}, updatedAt: OLD,
      manifest: rootManifest, existingAgentId: ROOT, agentArchivedAt: null }], [dependency]];
    await expect(resumeQueuedRunStartCore(RUN_ID)).resolves.toEqual({ ok: false, error: expect.stringContaining("未在服务端配置") });
    expect(mocks.reads).toEqual([]); expect(mocks.updateValues).toHaveLength(2);
    expect(mocks.updateValues[1]).toMatchObject({ status: "failed", error: expect.stringContaining("协作查询助手") });
    expect(mocks.evaluation).toHaveBeenCalledWith(RUN_ID, null, expect.stringContaining("未在服务端配置"));
    expect(mocks.insert).not.toHaveBeenCalled(); expect(mocks.reserve).not.toHaveBeenCalled(); expect(mocks.start).not.toHaveBeenCalled();
  });
});
