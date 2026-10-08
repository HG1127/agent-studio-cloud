import { beforeEach, describe, expect, it, vi } from "vitest";
import { REGRESSION_EXPECTATION_REQUIRED } from "@/server/domain/evaluation";

const mocks = vi.hoisted(() => {
  const selectRows: unknown[][] = [];
  const updateValues: unknown[] = [];
  const select = vi.fn(() => {
    const rows = selectRows.shift() ?? [];
    const query = {
      from: () => query,
      leftJoin: () => query,
      where: () => query,
      for: () => query,
      limit: async () => rows,
      then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
    };
    return query;
  });
  const update = vi.fn(() => ({ set: (values: unknown) => {
    updateValues.push(values);
    return { where: () => ({
      returning: async () => [],
      then: (resolve: (value: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
    }) };
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
  it.each([{ amount: 0, status: "passed" }, { amount: 101, status: "failed" }])("结果规则按启动快照判定 $amount，不读取后改范围", async ({ amount, status }) => {
    const schema = { type: "object", required: ["amount"], properties: { amount: { type: "number", minimum: 0, maximum: 100 } } };
    mocks.selectRows.push(
      [{ sourceType: "evaluation", sourceKey: `evaluation:${EVALUATION_ID}:${CASE_ID}`, workspaceId: WORKSPACE_ID }],
      [{ caseSnapshot: { name: "金额范围", input: {}, expectations: [], resultSchema: schema }, expectations: [], resultSchema: { type: "object", required: ["amount"], properties: { amount: { type: "number", minimum: 101, maximum: 200 } } } }],
      [{ agentId: CASE_ID, versionId: CASE_ID, workspaceId: WORKSPACE_ID, createdBy: CASE_ID, status: "running", totalCount: 1 }], [{ status }],
    );
    await completeEvaluationForRun("run-1", { amount });
    expect(mocks.updateValues[0]).toMatchObject({ status });
    expect(mocks.updateValues[1]).toMatchObject({ status: "completed", passedCount: Number(status === "passed"), failedCount: Number(status === "failed") });
  });

  it("历史快照未配置新规则时，不把后来新增的当前规则套回旧验收", async () => {
    mocks.selectRows.push(
      [{ sourceType: "evaluation", sourceKey: `evaluation:${EVALUATION_ID}:${CASE_ID}`, workspaceId: WORKSPACE_ID }],
      [{ caseSnapshot: { name: "原验收", input: {}, expectations: [{ path: "answer", operator: "exists" }] }, expectations: [], resultSchema: { type: "object", required: ["amount"] } }],
      [{ agentId: CASE_ID, versionId: CASE_ID, workspaceId: WORKSPACE_ID, createdBy: CASE_ID, status: "running", totalCount: 1 }], [{ status: "passed" }],
    );
    await completeEvaluationForRun("run-1", { answer: "原成果" });
    expect(mocks.updateValues[0]).toMatchObject({ status: "passed", error: null });
  });

  it("有当前结果规则但无启动快照时明确失败，不猜测历史规则", async () => {
    mocks.selectRows.push(
      [{ sourceType: "evaluation", sourceKey: `evaluation:${EVALUATION_ID}:${CASE_ID}`, workspaceId: WORKSPACE_ID }],
      [{ caseSnapshot: null, expectations: [], resultSchema: { type: "object" } }],
      [{ agentId: CASE_ID, versionId: CASE_ID, workspaceId: WORKSPACE_ID, createdBy: CASE_ID, status: "running", totalCount: 1 }], [{ status: "failed" }],
    );
    await completeEvaluationForRun("run-1", { amount: 0 });
    expect(mocks.updateValues[0]).toMatchObject({ status: "failed", error: "验收结果字段规则缺少启动快照，请重新验收" });
  });

  it("已开始的验收也不能把空条件回归样例算作通过", async () => {
    mocks.selectRows.push(
      [{ sourceType: "evaluation", sourceKey: `evaluation:${EVALUATION_ID}:${CASE_ID}`, workspaceId: WORKSPACE_ID }],
      [{ caseSnapshot: null, expectations: [] }],
      [{ id: "00000000-0000-4000-8000-0000000000a3" }],
      [{ agentId: "00000000-0000-4000-8000-0000000000a4", versionId: "00000000-0000-4000-8000-0000000000a5", workspaceId: WORKSPACE_ID, createdBy: "00000000-0000-4000-8000-0000000000a6", status: "running", totalCount: 1 }],
      [{ status: "failed" }],
    );

    await completeEvaluationForRun("run-1", { answer: "仍然错误" });

    expect(mocks.updateValues[0]).toMatchObject({ status: "failed", error: REGRESSION_EXPECTATION_REQUIRED });
    expect(mocks.updateValues[1]).toMatchObject({ status: "completed", passedCount: 0, failedCount: 1 });
    expect(mocks.update).toHaveBeenCalledTimes(2);
  });

  it("结果判定使用启动时冻结的条件而非样例当前条件", async () => {
    mocks.selectRows.push(
      [{ sourceType: "evaluation", sourceKey: `evaluation:${EVALUATION_ID}:${CASE_ID}`, workspaceId: WORKSPACE_ID }],
      [{ caseSnapshot: { name: "初始样例", input: {}, expectations: [{ path: "answer", operator: "equals", value: "通过" }] },
        expectations: [{ path: "answer", operator: "equals", value: "后来修改" }] }],
      [{ agentId: "00000000-0000-4000-8000-0000000000a4", versionId: "00000000-0000-4000-8000-0000000000a5", workspaceId: WORKSPACE_ID, createdBy: "00000000-0000-4000-8000-0000000000a6", status: "running", totalCount: 1 }],
      [{ status: "passed" }],
    );

    await completeEvaluationForRun("run-1", { answer: "通过" });

    expect(mocks.updateValues[0]).toMatchObject({ status: "passed", error: null });
    expect(mocks.updateValues[1]).toMatchObject({ status: "completed", passedCount: 1, failedCount: 0 });
  });

  it("快照损坏时不退回可编辑样例条件而误判通过", async () => {
    mocks.selectRows.push(
      [{ sourceType: "evaluation", sourceKey: `evaluation:${EVALUATION_ID}:${CASE_ID}`, workspaceId: WORKSPACE_ID }],
      [{ caseSnapshot: { name: "初始样例", input: {}, expectations: [{ path: "answer", operator: "equals" }] },
        expectations: [{ path: "answer", operator: "equals", value: "通过" }] }],
      [{ agentId: "00000000-0000-4000-8000-0000000000a4", versionId: "00000000-0000-4000-8000-0000000000a5", workspaceId: WORKSPACE_ID, createdBy: "00000000-0000-4000-8000-0000000000a6", status: "running", totalCount: 1 }],
      [{ status: "failed" }],
    );

    await completeEvaluationForRun("run-1", { answer: "通过" });

    expect(mocks.updateValues[0]).toMatchObject({ status: "failed" });
  });
});
