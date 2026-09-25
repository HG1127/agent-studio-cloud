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
    limit: takeRows,
    for: () => ({
      limit: () => {
        mocks.lock();
        return takeRows();
      },
    }),
  }),
  innerJoin: () => ({ where: () => ({ limit: takeRows }) }),
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
      [{ id: AGENT_ID, name: "资料整理助手" }],
      [{ name: "客户服务助手" }],
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
      [{ id: AGENT_ID, name: "资料整理助手" }],
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

  it("锁内状态已经变化时不覆盖", async () => {
    mocks.rows = [[]];

    await expect(setAgentArchivedAction({ agentId: AGENT_ID, archived: true })).resolves.toEqual({
      ok: false,
      error: "助手状态已经变化，请刷新页面后重试",
    });
    expect(mocks.updates).toHaveLength(0);
  });
});
