import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[][],
  updates: [] as Array<Record<string, unknown>>,
  auditEvents: [] as Array<Record<string, unknown>>,
  revalidatePath: vi.fn(),
}));

const tx = {
  select: () => ({
    from: () => ({
      innerJoin: () => ({
        where: () => ({
          for: () => ({ limit: async () => mocks.rows.shift() ?? [] }),
        }),
      }),
    }),
  }),
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
  insert: () => ({
    values: async (value: Record<string, unknown>) => { mocks.auditEvents.push(value); },
  }),
};

vi.mock("@/lib/db", () => ({ db: { transaction: async (run: (client: typeof tx) => unknown) => run(tx) } }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { setMemoryArchivedAction } from "@/server/actions/archive-memory";

const MEMORY_ID = "00000000-0000-4000-8000-000000000081";

beforeEach(() => {
  mocks.rows = [];
  mocks.updates = [];
  mocks.auditEvents = [];
  mocks.revalidatePath.mockReset();
});

describe("经验状态操作记录", () => {
  it("停用经验与操作记录在同一事务中写入", async () => {
    mocks.rows = [[{ id: MEMORY_ID, agentName: "续约助手" }]];

    await expect(setMemoryArchivedAction({ memoryId: MEMORY_ID, archived: true }))
      .resolves.toEqual({ ok: true });

    expect(mocks.updates[0].archivedAt).toBeInstanceOf(Date);
    expect(mocks.auditEvents).toContainEqual(expect.objectContaining({
      action: "memory.archived",
      targetType: "memory",
      targetId: MEMORY_ID,
      summary: "停用助手「续约助手」的一条经验",
    }));
  });

  it("状态已经变化时不写操作记录", async () => {
    mocks.rows = [[]];

    await expect(setMemoryArchivedAction({ memoryId: MEMORY_ID, archived: false }))
      .resolves.toEqual({ ok: false, error: "经验状态已经变化，请刷新页面后重试" });
    expect(mocks.auditEvents).toHaveLength(0);
  });
});
