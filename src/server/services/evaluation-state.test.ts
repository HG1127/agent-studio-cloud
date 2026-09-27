import { beforeEach, describe, expect, it, vi } from "vitest";
import { REGRESSION_EXPECTATION_REQUIRED } from "@/server/domain/evaluation";

const mocks = vi.hoisted(() => {
  const selectRows: unknown[][] = [];
  const updateValues: unknown[] = [];
  const select = vi.fn(() => {
    const rows = selectRows.shift() ?? [];
    const query = {
      from: () => query,
      where: () => query,
      for: () => query,
      limit: async () => rows,
      then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
    };
    return query;
  });
  const update = vi.fn(() => ({ set: (values: unknown) => {
    updateValues.push(values);
    return { where: async () => [] };
  } }));
  const insert = vi.fn(() => ({ values: async () => [] }));
  return { selectRows, updateValues, select, update, insert };
});

vi.mock("@/lib/db", () => ({ db: {
  select: mocks.select,
  update: mocks.update,
  transaction: async (callback: (tx: unknown) => unknown) => callback({
    select: mocks.select, update: mocks.update, insert: mocks.insert,
  }),
} }));

import { completeEvaluationForRun } from "@/server/services/evaluation-state";

const EVALUATION_ID = "00000000-0000-4000-8000-0000000000a1";
const CASE_ID = "00000000-0000-4000-8000-0000000000a2";
const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  mocks.selectRows.length = 0;
  mocks.updateValues.length = 0;
  mocks.select.mockClear();
  mocks.update.mockClear();
  mocks.insert.mockClear();
});

describe("改进回归样例的结果判定", () => {
  it("已开始的验收也不能把空条件回归样例算作通过", async () => {
    mocks.selectRows.push(
      [{ sourceType: "evaluation", sourceKey: `evaluation:${EVALUATION_ID}:${CASE_ID}`, workspaceId: WORKSPACE_ID }],
      [{ expectations: [] }],
      [{ id: "00000000-0000-4000-8000-0000000000a3" }],
      [{ agentId: "00000000-0000-4000-8000-0000000000a4", versionId: "00000000-0000-4000-8000-0000000000a5", workspaceId: WORKSPACE_ID, createdBy: "00000000-0000-4000-8000-0000000000a6", status: "running", totalCount: 1 }],
      [{ status: "failed" }],
    );

    await completeEvaluationForRun("run-1", { answer: "仍然错误" });

    expect(mocks.updateValues[0]).toMatchObject({ status: "failed", error: REGRESSION_EXPECTATION_REQUIRED });
    expect(mocks.updateValues[1]).toMatchObject({ status: "completed", passedCount: 0, failedCount: 1 });
    expect(mocks.update).toHaveBeenCalledTimes(2);
  });
});
