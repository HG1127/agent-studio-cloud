import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { FatalError } from "workflow";
import { WorkflowNode } from "@/contracts/workflow";
import { AgentManifest } from "@/contracts/manifest";

const mocks = vi.hoisted(() => ({ select: vi.fn(), where: vi.fn(), persist: vi.fn(), trace: vi.fn(), candidate: vi.fn(), exact: vi.fn(), calls: 0 }));
vi.mock("@/lib/db", () => ({ db: { select: mocks.select } }));
vi.mock("@/server/steps/run-state", () => ({ persistStep: mocks.persist }));
vi.mock("@/server/steps/trace-step", () => ({ appendTrace: mocks.trace }));
vi.mock("@/db/knowledge-candidate-filter", () => ({ knowledgeCandidateFilter: mocks.candidate, knowledgeExactMatchFilter: mocks.exact }));
import { runKnowledgeStep } from "./knowledge-step";

const sourceId = "00000000-0000-4000-8000-000000000001";
const outsideId = "00000000-0000-4000-8000-000000000002";
const workspaceId = "00000000-0000-4000-8000-000000000003";
const base = AgentManifest.parse({ schemaVersion: "4.0", workflowFingerprint: "knowledge-mapping", inputContract: { fields: [] }, resourceSelection: { model: { modelId: "mock", mock: true } }, designAudit: { status: "passed", issueCount: 0, criticalCount: 0 }, knowledgeSnapshot: [sourceId], workflowSnapshot: { id: "draft", startNodeId: "start", rootAgent: { id: "agent", name: "资料助手", role: "owner" }, nodes: { start: { id: "start", title: "开始", type: "trigger", next: "end" }, end: { id: "end", title: "结束", type: "end", next: null } }, memoryPolicy: { taskContext: true, longTerm: false } } });
const node = WorkflowNode.parse({ id: "lookup", title: "查阅资料", type: "knowledge", knowledge: { space: "售后资料", query: "旧固定内容", sourceIds: [sourceId] }, inputMapping: { fields: [
  { target: ["query"], source: { kind: "output", nodeId: "extract", path: ["topic"] } },
  { target: ["sourceIds"], source: { kind: "literal", value: [outsideId] } },
] } });

beforeEach(() => {
  mocks.calls = 0;
  for (const mock of [mocks.persist, mocks.trace, mocks.where, mocks.candidate, mocks.exact]) mock.mockReset();
  mocks.select.mockReset().mockImplementation(() => {
    const rows = mocks.calls++ === 0 ? [{ workspaceId }] : [{ sourceId, sourceName: "售后手册", chunkIndex: 0, content: "退货政策：七天内可退。" }];
    const query = { where: (value: unknown) => { mocks.where(value); return query; }, innerJoin: () => query, orderBy: () => query, limit: async () => rows };
    return { from: () => query };
  });
});

describe("知识步骤输入映射", () => {
  it("检索只使用显式主题，映射字段不能改变冻结来源和工作区", async () => {
    const { receipt } = await runKnowledgeStep({ runId: "run", node, manifest: base, input: { query: "原任务" }, outputs: { extract: { topic: "退货政策" }, private: { secret: "unselected-secret" } }, currentItem: "其他循环主题" });
    expect(receipt).toMatchObject({ query: "退货政策", hitCount: 1, scannedCount: 1 });
    expect(mocks.candidate).toHaveBeenCalledWith("退货政策");
    const params = new PgDialect().sqlToQuery(mocks.where.mock.calls[1][0]).params;
    expect(params).toContain(sourceId); expect(params).toContain(workspaceId); expect(params).not.toContain(outsideId);
    expect(JSON.stringify(receipt)).not.toContain("unselected-secret");
    expect(mocks.persist).toHaveBeenLastCalledWith(expect.objectContaining({ status: "succeeded", output: receipt }));
  });

  it.each([{}, { topic: null }, { topic: "Bearer mapped-query-secret" }])("映射无效时不查询知识库，也不改用原任务 %#", async (extract) => {
    const execution = runKnowledgeStep({ runId: "run", node, manifest: base, input: { query: "退货政策" }, outputs: { extract } });
    await expect(execution).rejects.toBeInstanceOf(FatalError);
    await expect(execution).rejects.toThrow();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.candidate).not.toHaveBeenCalled();
    expect(mocks.persist).toHaveBeenLastCalledWith(expect.objectContaining({ status: "failed" }));
    expect(JSON.stringify(mocks.persist.mock.calls)).not.toContain("mapped-query-secret");
  });

  it("原无映射节点的固定检索行为不变", async () => {
    const legacy = WorkflowNode.parse({ id: "lookup", title: "旧检索", type: "knowledge", knowledge: { space: "售后资料", query: "退货政策" } });
    expect((await runKnowledgeStep({ runId: "run", node: legacy, manifest: base, input: { query: "原任务" } })).receipt.query).toBe("退货政策");
  });
});
