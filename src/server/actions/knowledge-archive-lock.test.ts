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
    from: () => ({
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
    }),
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
      [{ id: "00000000-0000-4000-8000-000000000092" }],
    ];

    await expect(setKnowledgeSourceArchivedAction({ sourceId: SOURCE_ID, archived: true }))
      .resolves.toEqual({
        ok: false,
        error: "这份资料仍被当前版本或待验收版本使用，请先发布不再使用它的新版本",
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
