import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ reads: vi.fn(), txReads: vi.fn(), transaction: vi.fn(), chain: vi.fn(), scope: vi.fn(), lock: vi.fn(), cap: vi.fn(), insert: vi.fn() }));
vi.mock("workflow", async (original) => ({ ...await original<typeof import("workflow")>(), getStepMetadata: () => ({ stepId: "same-step" }) }));
vi.mock("@/lib/db", () => ({ db: { select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: mocks.reads }) }), where: () => ({ limit: mocks.reads }) }) }), transaction: mocks.transaction } }));
vi.mock("@/server/services/collaboration-chain", () => ({ loadCollaborationChain: mocks.chain }));
vi.mock("@/server/steps/run-state", () => ({ persistStep: vi.fn() }));
vi.mock("@/server/steps/trace-step", () => ({ appendTrace: vi.fn() }));
vi.mock("@/server/services/execution-resources", async (original) => ({ ...await original<typeof import("@/server/services/execution-resources")>(), lockExecutionWorkspace: mocks.lock, prepareExecutionResourceScope: mocks.scope, enforceChildRunResourceLimit: mocks.cap }));
import { AgentManifest } from "@/contracts/manifest";
import { WorkflowNode } from "@/contracts/workflow";
import { beginAgentCall } from "./agent-call-step";
import { beginHandoff } from "./handoff-step";
const root = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", target = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", child = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", workspace = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const definition = AgentManifest.parse({ schemaVersion: "4.0", workflowFingerprint: "dedup", inputContract: { fields: [] }, resourceSelection: { model: { modelId: "mock", mock: true } }, designAudit: { status: "passed", issueCount: 0, criticalCount: 0 }, workflowSnapshot: { id: "dedup", startNodeId: "start", rootAgent: { id: target, name: "协作助手", role: "测试" }, memoryPolicy: { taskContext: true, longTerm: false }, nodes: { start: { id: "start", title: "开始", type: "trigger", next: "done" }, done: { id: "done", title: "完成", type: "end", next: null } } } });
beforeEach(() => {
  vi.clearAllMocks(); mocks.reads.mockReset().mockResolvedValueOnce([{ workspaceId: workspace, createdBy: root, agentId: root }]).mockResolvedValueOnce([{ name: "协作助手", manifest: definition }]);
  mocks.chain.mockResolvedValue([{ runId: root, agentId: root, sourceType: "manual", sourceKey: null }]); mocks.scope.mockResolvedValue({ rootRunId: root, ids: [root, child] });
  mocks.txReads.mockReset().mockResolvedValueOnce([{ id: root }]).mockResolvedValueOnce([{ id: child }]);
  mocks.cap.mockImplementation(() => { throw new Error("额度已经用完，原请求不应该再次检查新任务额度"); });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({ select: () => { const query = { from: () => query, where: () => query, for: () => query, limit: mocks.txReads }; return query; }, insert: mocks.insert }));
});
describe("协作任务原请求准入防重", () => {
  it.each(["agent_call", "handoff"] as const)("%s 在已满额度下找回原子任务，不再次计数或插入", async (kind) => {
    const node = WorkflowNode.parse({ id: "delegate", title: "协作处理", type: kind, next: null, ...(kind === "agent_call" ? { agentCall: { targetAgentId: target, versionId: target } } : { toAgent: { id: target, versionId: target, name: "协作助手" }, contract: { deliverables: ["处理成果"], mustNotInclude: ["密钥"], inputSchema: [{ name: "brief", type: "string", required: true }], outputSchema: [{ name: "result", type: "any", required: true }], memoryPolicy: { mode: "none", shared: [], private: ["密钥"] } } }) });
    const result = await (kind === "agent_call" ? beginAgentCall : beginHandoff)({ runId: root, node, parentInput: {}, outputs: {} });
    expect(result.childRunId).toBe(child); expect(mocks.lock).toHaveBeenCalledExactlyOnceWith(expect.anything(), workspace); expect(mocks.cap).not.toHaveBeenCalled(); expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.scope.mock.invocationCallOrder[0]);
  });
});
