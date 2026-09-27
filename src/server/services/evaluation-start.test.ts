import { beforeEach, describe, expect, it, vi } from "vitest";
import { REGRESSION_EXPECTATION_REQUIRED } from "@/server/domain/evaluation";

const mocks = vi.hoisted(() => {
  const selectRows: unknown[][] = [];
  const select = vi.fn(() => {
    const rows = selectRows.shift() ?? [];
    const query = {
      from: () => query,
      innerJoin: () => query,
      where: () => query,
      for: () => query,
      orderBy: () => query,
      limit: async () => rows,
    };
    return query;
  });
  const insert = vi.fn(() => {
    const query = {
      values: () => query,
      returning: async () => [{ id: "00000000-0000-4000-8000-0000000000a5" }],
      then: (resolve: (value: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
    };
    return query;
  });
  return { selectRows, select, insert };
});

vi.mock("@/lib/db", () => ({ db: {
  transaction: async (callback: (tx: unknown) => unknown) => callback({ select: mocks.select, insert: mocks.insert }),
} }));

import { prepareEvaluationRun } from "@/server/services/evaluation-start";

const AGENT_ID = "00000000-0000-4000-8000-0000000000a1";
const CASE_ID = "00000000-0000-4000-8000-0000000000a2";

beforeEach(() => {
  mocks.selectRows.length = 0;
  mocks.select.mockClear();
  mocks.insert.mockClear();
});

describe("改进回归样例的启动门禁", () => {
  it("反馈关联的样例没有验收条件时拒绝启动，不创建验收运行", async () => {
    mocks.selectRows.push(
      [{ id: AGENT_ID, name: "客户助手" }],
      [],
      [{ id: "00000000-0000-4000-8000-0000000000a3" }],
      [{ id: CASE_ID, input: {}, expectations: [] }],
      [{ id: "00000000-0000-4000-8000-0000000000a4" }],
    );

    await expect(prepareEvaluationRun(AGENT_ID)).resolves.toEqual({ ok: false, error: REGRESSION_EXPECTATION_REQUIRED });
    expect(mocks.select).toHaveBeenCalledTimes(5);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("普通空条件样例仍能用于基础流程检查", async () => {
    mocks.selectRows.push(
      [{ id: AGENT_ID, name: "客户助手" }],
      [],
      [{ id: "00000000-0000-4000-8000-0000000000a3" }],
      [{ id: CASE_ID, input: {}, expectations: [] }],
      [],
    );

    await expect(prepareEvaluationRun(AGENT_ID)).resolves.toMatchObject({
      ok: true,
      cases: [{ id: CASE_ID, input: {}, expectations: [] }],
      resumed: false,
    });
    expect(mocks.insert).toHaveBeenCalledTimes(3);
  });
});
