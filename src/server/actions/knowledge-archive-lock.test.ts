import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[][],
  updates: [] as Array<Record<string, unknown>>,
  auditEvents: [] as Array<Record<string, unknown>>,
  lock: vi.fn(),
  revalidatePath: vi.fn(),
}));

const tx = {
  select: () => ({
    from: () => {
      const tail = {
      where: () => {
        const take = async () => mocks.rows.shift() ?? [];
        return {
          then: (resolve: (value: unknown[]) => unknown) => take().then(resolve),
          limit: take,
          for: () => ({
            limit: async () => {
              mocks.lock();
              return take();
            },
          }),
        };
      },
      };
      return { ...tail, innerJoin: () => tail };
    },
  }),
  update: () => ({
    set: (value: Record<string, unknown>) => ({
      where: () => ({
        returning: async () => {
          mocks.updates.push(value);
          return [{ id: "00000000-0000-4000-8000-000000000091" }];
        },
      }),
    }),
  }),
  insert: () => ({
    values: async (value: Record<string, unknown>) => { mocks.auditEvents.push(value); },
  }),
};

vi.mock("@/lib/db", () => ({ db: { transaction: async (run: (client: typeof tx) => unknown) => run(tx) } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { setKnowledgeSourceArchivedAction } from "@/server/actions/archive-knowledge-source";

const SOURCE_ID = "00000000-0000-4000-8000-000000000091";

beforeEach(() => {
  mocks.rows = [];
  mocks.updates = [];
  mocks.auditEvents = [];
  mocks.lock.mockReset();
  mocks.revalidatePath.mockReset();
});

describe("知识资料归档并发保护", () => {
  it("持有来源行锁后按最新分片状态恢复资料", async () => {
    mocks.rows = [[{ id: SOURCE_ID, name: "退款规则.md", status: "archived", chunkCount: 3, error: null }]];

    await expect(setKnowledgeSourceArchivedAction({ sourceId: SOURCE_ID, archived: false }))
      .resolves.toEqual({ ok: true });
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(mocks.updates).toHaveLength(1);
    expect(mocks.updates[0]).toMatchObject({ archivedAt: null, status: "indexed" });
    expect(mocks.auditEvents).toContainEqual(expect.objectContaining({
      action: "knowledge.restored",
      targetType: "knowledge",
      targetId: SOURCE_ID,
      summary: "恢复知识资料「退款规则.md」",
    }));
  });

  it("当前版本仍在使用资料时拒绝归档", async () => {
    mocks.rows = [
      [{ id: SOURCE_ID, name: "退款规则.md", status: "indexed", chunkCount: 3, error: null }],
      [{
        versionId: "00000000-0000-4000-8000-000000000092",
        agentId: "00000000-0000-4000-8000-000000000093",
        agentName: "客户服务助手",
        status: "production",
        agentArchivedAt: null,
        manifest: {
          schemaVersion: "4.0",
          workflowSnapshot: {
            id: "workflow", versionId: null, startNodeId: "start",
            rootAgent: { id: "00000000-0000-4000-8000-000000000093", name: "客户服务助手", role: "处理" },
            nodes: {
              start: { id: "start", title: "开始", type: "trigger", next: "done" },
              done: { id: "done", title: "完成", type: "end", next: null },
            },
            memoryPolicy: { taskContext: true, longTerm: false },
          },
          workflowFingerprint: "fingerprint", inputContract: { fields: [] }, outputContract: { fields: [] },
          resourceSelection: { model: { modelId: "mock", mock: true, connectionId: null } },
          designAudit: { status: "passed", issueCount: 0, criticalCount: 0 }, knowledgeSnapshot: [SOURCE_ID],
        },
      }],
    ];

    await expect(setKnowledgeSourceArchivedAction({ sourceId: SOURCE_ID, archived: true }))
      .resolves.toEqual({
        ok: false,
        error: "助手「客户服务助手」的当前版本或待验收版本仍在使用这份资料，请先发布不再使用它的新版本",
      });
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.auditEvents).toHaveLength(0);
  });

  it("旧冻结版本仍在运行时拒绝归档资料", async () => {
    const rootVersionId = "00000000-0000-4000-8000-000000000094";
    mocks.rows = [
      [{ id: SOURCE_ID, name: "退款规则.md", status: "indexed", chunkCount: 3, error: null }],
      [{
        versionId: rootVersionId,
        agentId: "00000000-0000-4000-8000-000000000095",
        agentName: "运行中的旧助手",
        status: "retired",
        agentArchivedAt: null,
        manifest: {
          schemaVersion: "4.0",
          workflowSnapshot: {
            id: "workflow", startNodeId: "start",
            rootAgent: { id: "00000000-0000-4000-8000-000000000095", name: "运行中的旧助手", role: "处理" },
            nodes: {
              start: { id: "start", title: "开始", type: "trigger", next: "done" },
              done: { id: "done", title: "完成", type: "end", next: null },
            },
            memoryPolicy: { taskContext: true, longTerm: false },
          },
          workflowFingerprint: "fingerprint", inputContract: { fields: [] }, outputContract: { fields: [] },
          resourceSelection: { model: { modelId: "mock", mock: true, connectionId: null } },
          designAudit: { status: "passed", issueCount: 0, criticalCount: 0 }, knowledgeSnapshot: [SOURCE_ID],
        },
      }],
      [{ versionId: rootVersionId }],
    ];

    await expect(setKnowledgeSourceArchivedAction({ sourceId: SOURCE_ID, archived: true }))
      .resolves.toEqual({
        ok: false,
        error: "助手「运行中的旧助手」仍有运行中的任务需要这份资料，请等待运行结束后再归档",
      });
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.auditEvents).toHaveLength(0);
  });

  it("锁内状态已变化时不再覆盖资料", async () => {
    mocks.rows = [[]];

    await expect(setKnowledgeSourceArchivedAction({ sourceId: SOURCE_ID, archived: true }))
      .resolves.toEqual({ ok: false, error: "知识资料状态已经变化，请刷新页面后重试" });
    expect(mocks.updates).toHaveLength(0);
  });
});
