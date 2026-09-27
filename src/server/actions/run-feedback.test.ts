import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const selectRows: unknown[][] = [];
  const insertValues: unknown[] = [];
  const select = vi.fn(() => {
    const rows = selectRows.shift() ?? [];
    const query = { from: () => query, where: () => query, for: () => query, limit: async () => rows };
    return query;
  });
  const insert = vi.fn(() => {
    const query = {
      values: (values: unknown) => { insertValues.push(values); return query; },
      returning: async () => [savedRow],
      then: (resolve: (value: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
    };
    return query;
  });
  const savedRow = {
    id: "00000000-0000-4000-8000-0000000000a3",
    runId: "00000000-0000-4000-8000-0000000000a1",
    agentId: "00000000-0000-4000-8000-0000000000a2",
    rating: "useful",
    note: null,
    evaluationCaseId: "00000000-0000-4000-8000-0000000000a4",
    updatedAt: new Date("2026-09-27T00:00:00.000Z"),
  };
  const update = vi.fn(() => ({
    set: (values: Record<string, unknown>) => ({ where: () => ({ returning: async () => [{ ...savedRow, ...values }] }) }),
  }));
  return { selectRows, insertValues, select, insert, update, savedRow, revalidatePath: vi.fn(), outerSelect: vi.fn() };
});

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/db", () => ({ db: {
  transaction: async (callback: (tx: unknown) => unknown) => callback({ select: mocks.select, insert: mocks.insert, update: mocks.update }),
  select: mocks.outerSelect,
} }));

import { saveRunFeedbackAction } from "@/server/actions/run-feedback";

const RUN_ID = "00000000-0000-4000-8000-0000000000a1";
const AGENT_ID = "00000000-0000-4000-8000-0000000000a2";
const CASE_ID = "00000000-0000-4000-8000-0000000000a4";

beforeEach(() => {
  mocks.selectRows.length = 0;
  mocks.insertValues.length = 0;
  mocks.select.mockClear();
  mocks.insert.mockClear();
  mocks.update.mockClear();
  mocks.outerSelect.mockClear();
  mocks.revalidatePath.mockReset();
});

describe("运行反馈保存一致性", () => {
  it("在写入事务内确定可返回的反馈，不在提交后再次查询", async () => {
    mocks.selectRows.push(
      [{ id: RUN_ID, agentId: AGENT_ID, status: "completed" }],
      [],
      [{ id: CASE_ID }],
    );

    await expect(saveRunFeedbackAction({ runId: RUN_ID, rating: "useful", note: null })).resolves.toEqual({
      ok: true,
      feedback: {
        id: mocks.savedRow.id,
        runId: RUN_ID,
        rating: "useful",
        note: null,
        evaluationCaseId: CASE_ID,
        updatedAt: "2026-09-27T00:00:00.000Z",
      },
    });
    expect(mocks.select).toHaveBeenCalledTimes(3);
    expect(mocks.outerSelect).not.toHaveBeenCalled();
    expect(mocks.insert).toHaveBeenCalledTimes(2);
  });

  it("页面缓存刷新失败时仍如实返回已提交的成功结果", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.selectRows.push(
      [{ id: RUN_ID, agentId: AGENT_ID, status: "completed" }],
      [],
      [{ id: CASE_ID }],
    );
    mocks.revalidatePath.mockImplementationOnce(() => { throw new Error("refresh failed"); });

    const result = await saveRunFeedbackAction({ runId: RUN_ID, rating: "useful", note: null });

    expect(result.ok).toBe(true);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/runs/${RUN_ID}`);
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("相同反馈重试只读取现有记录，不重复写入审计", async () => {
    mocks.selectRows.push(
      [{ id: RUN_ID, agentId: AGENT_ID, status: "completed" }],
      [mocks.savedRow],
      [{ id: CASE_ID }],
    );

    const result = await saveRunFeedbackAction({ runId: RUN_ID, rating: "useful", note: null });

    expect(result.ok).toBe(true);
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.outerSelect).not.toHaveBeenCalled();
  });

  it("更改反馈时连同新的结果视图在事务内确定", async () => {
    mocks.selectRows.push(
      [{ id: RUN_ID, agentId: AGENT_ID, status: "completed" }],
      [mocks.savedRow],
      [{ id: CASE_ID }],
    );

    const result = await saveRunFeedbackAction({ runId: RUN_ID, rating: "needs_improvement", note: "请改进" });

    expect(result).toMatchObject({ ok: true, feedback: { rating: "needs_improvement", note: "请改进" } });
    expect(mocks.update).toHaveBeenCalledOnce();
    expect(mocks.insert).toHaveBeenCalledOnce();
    expect(mocks.outerSelect).not.toHaveBeenCalled();
  });
});
