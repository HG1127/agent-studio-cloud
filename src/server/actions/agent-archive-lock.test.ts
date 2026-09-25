import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[][],
  updates: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<Record<string, unknown>>,
  lock: vi.fn(),
  revalidatePath: vi.fn(),
}));

function takeRows() {
  return Promise.resolve(mocks.rows.shift() ?? []);
}

const selectTail = {
  where: () => ({
    then: (resolve: (value: unknown[]) => unknown) => takeRows().then(resolve),
    limit: takeRows,
    for: () => ({
      limit: () => {
        mocks.lock();
        return takeRows();
      },
    }),
  }),
  innerJoin: () => ({ where: () => ({ then: (resolve: (value: unknown[]) => unknown) => takeRows().then(resolve) }) }),
};

const tx = {
  select: () => ({ from: () => selectTail }),
  update: () => ({
    set: (value: Record<string, unknown>) => ({
      where: () => ({
        returning: async () => {
          mocks.updates.push(value);
          return [{ id: "00000000-0000-4000-8000-000000000081" }];
        },
      }),
    }),
  }),
  insert: () => ({ values: async (value: Record<string, unknown>) => { mocks.inserts.push(value); } }),
};

vi.mock("@/lib/db", () => ({ db: { transaction: async (run: (client: typeof tx) => unknown) => run(tx) } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { setAgentArchivedAction } from "@/server/actions/set-agent-archived";

const AGENT_ID = "00000000-0000-4000-8000-000000000081";

beforeEach(() => {
  mocks.rows = [];
  mocks.updates = [];
  mocks.inserts = [];
  mocks.lock.mockReset();
  mocks.revalidatePath.mockReset();
});

describe("助手停用依赖保护", () => {
  it("被其他在线版本使用时拒绝停用", async () => {
    mocks.rows = [
      [{ id: AGENT_ID, name: "资料整理助手", archivedAt: null }],
      [],
      [{
        versionId: "00000000-0000-4000-8000-000000000083",
        agentId: "00000000-0000-4000-8000-000000000082",
        agentName: "客户服务助手",
        status: "production",
        agentArchivedAt: null,
        manifest: {
          schemaVersion: "4.0",
          workflowSnapshot: {
            id: "workflow", versionId: null, startNodeId: "start",
            rootAgent: { id: "00000000-0000-4000-8000-000000000082", name: "客户服务助手", role: "处理" },
            nodes: {
              start: { id: "start", title: "开始", type: "trigger", next: "call" },
              call: { id: "call", title: "协作", type: "agent_call", next: "done", agentCall: { targetAgentId: AGENT_ID, versionId: "00000000-0000-4000-8000-000000000084" } },
              done: { id: "done", title: "完成", type: "end", next: null },
            },
            memoryPolicy: { taskContext: true, longTerm: false },
          },
          workflowFingerprint: "fingerprint", inputContract: { fields: [] }, outputContract: { fields: [] },
          resourceSelection: { model: { modelId: "mock", mock: true, connectionId: null } },
          designAudit: { status: "passed", issueCount: 0, criticalCount: 0 }, knowledgeSnapshot: [],
        },
      }],
    ];

    await expect(setAgentArchivedAction({ agentId: AGENT_ID, archived: true })).resolves.toEqual({
      ok: false,
      error: "助手「客户服务助手」的当前版本或待验收版本仍在使用它，请先调整并重新发布",
    });
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.inserts).toHaveLength(0);
  });

  it("没有在线依赖时持有行锁并停用", async () => {
    mocks.rows = [
      [{ id: AGENT_ID, name: "资料整理助手", archivedAt: null }],
      [],
      [],
    ];

    await expect(setAgentArchivedAction({ agentId: AGENT_ID, archived: true })).resolves.toEqual({ ok: true });
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(mocks.updates[0]).toMatchObject({ archivedAt: expect.any(Date) });
    expect(mocks.inserts).toContainEqual(expect.objectContaining({
      action: "agent.archived",
      targetType: "agent",
      targetId: AGENT_ID,
      summary: "停用助手「资料整理助手」",
    }));
  });

  it("旧冻结版本仍在运行时拒绝停用其协作助手", async () => {
    const rootVersionId = "00000000-0000-4000-8000-000000000086";
    mocks.rows = [
      [{ id: AGENT_ID, name: "资料整理助手", archivedAt: null }],
      [],
      [{
        versionId: rootVersionId,
        agentId: "00000000-0000-4000-8000-000000000087",
        agentName: "运行中的旧助手",
        status: "retired",
        agentArchivedAt: null,
        manifest: {
          schemaVersion: "4.0",
          workflowSnapshot: {
            id: "workflow", startNodeId: "start",
            rootAgent: { id: "00000000-0000-4000-8000-000000000087", name: "运行中的旧助手", role: "处理" },
            nodes: {
              start: { id: "start", title: "开始", type: "trigger", next: "call" },
              call: { id: "call", title: "协作", type: "agent_call", next: "done", agentCall: { targetAgentId: AGENT_ID, versionId: "00000000-0000-4000-8000-000000000088" } },
              done: { id: "done", title: "完成", type: "end", next: null },
            },
            memoryPolicy: { taskContext: true, longTerm: false },
          },
          workflowFingerprint: "fingerprint", inputContract: { fields: [] }, outputContract: { fields: [] },
          resourceSelection: { model: { modelId: "mock", mock: true, connectionId: null } },
          designAudit: { status: "passed", issueCount: 0, criticalCount: 0 }, knowledgeSnapshot: [],
        },
      }],
      [{ versionId: rootVersionId }],
    ];

    await expect(setAgentArchivedAction({ agentId: AGENT_ID, archived: true })).resolves.toEqual({
      ok: false,
      error: "助手「运行中的旧助手」仍有运行中的任务需要这个协作助手，请等待运行结束后再停用",
    });
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.inserts).toHaveLength(0);
  });

  it("自动验收运行期间拒绝停用", async () => {
    mocks.rows = [
      [{ id: AGENT_ID, name: "资料整理助手", archivedAt: null }],
      [{ id: "00000000-0000-4000-8000-000000000085" }],
    ];

    await expect(setAgentArchivedAction({ agentId: AGENT_ID, archived: true })).resolves.toEqual({
      ok: false,
      error: "自动验收运行期间不能停用助手，请等待验收完成",
    });
    expect(mocks.lock).toHaveBeenCalledOnce();
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.inserts).toHaveLength(0);
  });

  it("锁内状态已经变化时不覆盖", async () => {
    mocks.rows = [[]];

    await expect(setAgentArchivedAction({ agentId: AGENT_ID, archived: true })).resolves.toEqual({
      ok: false,
      error: "助手状态已经变化，请刷新页面后重试",
    });
    expect(mocks.updates).toHaveLength(0);
  });

  it("重复停用已停用助手时直接返回成功且不重复审计", async () => {
    mocks.rows = [[{ id: AGENT_ID, name: "资料整理助手", archivedAt: new Date() }]];

    await expect(setAgentArchivedAction({ agentId: AGENT_ID, archived: true })).resolves.toEqual({ ok: true });
    expect(mocks.updates).toHaveLength(0);
    expect(mocks.inserts).toHaveLength(0);
  });
});
