import { beforeEach, describe, expect, it, vi } from "vitest";
import { REGRESSION_EXPECTATION_REQUIRED } from "@/server/domain/evaluation";

const mocks = vi.hoisted(() => {
  const selectRows: unknown[][] = [];
  const insertedValues: unknown[] = [];
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
      values: (value: unknown) => { insertedValues.push(value); return query; },
      returning: async () => [{ id: "00000000-0000-4000-8000-0000000000a5" }],
      then: (resolve: (value: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
    };
    return query;
  });
  return { selectRows, insertedValues, select, insert };
});

vi.mock("@/lib/db", () => ({ db: {
  transaction: async (callback: (tx: unknown) => unknown) => callback({ select: mocks.select, insert: mocks.insert }),
} }));

import { prepareEvaluationRun } from "@/server/services/evaluation-start";

const AGENT_ID = "00000000-0000-4000-8000-0000000000a1";
const CASE_ID = "00000000-0000-4000-8000-0000000000a2";

beforeEach(() => {
  mocks.selectRows.length = 0;
  mocks.insertedValues.length = 0;
  mocks.select.mockClear();
  mocks.insert.mockClear();
});

describe("改进回归样例的启动门禁", () => {
  it("有效结果规则可作为空断言回归样例的条件，并冻结到原轮", async () => {
    const resultSchema = { type: "object", required: ["amount"], properties: { amount: { type: "number", minimum: 0, maximum: 100 } } };
    mocks.selectRows.push([{ id: AGENT_ID, name: "金额助手" }], [], [{ id: "00000000-0000-4000-8000-0000000000a3" }], [{ id: CASE_ID, name: "金额范围", input: {}, expectations: [], resultSchema }]);
    await expect(prepareEvaluationRun(AGENT_ID)).resolves.toMatchObject({ ok: true });
    expect(mocks.select).toHaveBeenCalledTimes(4);
    expect(mocks.insertedValues[1]).toEqual([expect.objectContaining({ caseSnapshot: { name: "金额范围", input: {}, expectations: [], resultSchema } })]);
  });

  it("当前样例规则损坏时不建立验收运行", async () => {
    mocks.selectRows.push([{ id: AGENT_ID, name: "金额助手" }], [], [{ id: "00000000-0000-4000-8000-0000000000a3" }], [{ id: CASE_ID, name: "金额范围", input: {}, expectations: [], resultSchema: { type: "object", $ref: "unknown" } }]);
    await expect(prepareEvaluationRun(AGENT_ID)).resolves.toMatchObject({ ok: false });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("原轮规则快照无效时拒绝继续，不退回当前可编辑条件", async () => {
    mocks.selectRows.push([{ id: AGENT_ID, name: "金额助手" }], [{ id: "00000000-0000-4000-8000-0000000000a5", agentId: AGENT_ID, versionId: "00000000-0000-4000-8000-0000000000a3", status: "running" }], [{ id: CASE_ID, input: {}, caseSnapshot: { name: "金额范围", input: {}, expectations: [], resultSchema: { type: "object", $ref: "unknown" } } }]);
    await expect(prepareEvaluationRun(AGENT_ID)).resolves.toEqual({ ok: false, error: "验收结果字段规则快照无效，请重新验收" });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("反馈关联的样例没有验收条件时拒绝启动，不创建验收运行", async () => {
    mocks.selectRows.push(
      [{ id: AGENT_ID, name: "客户助手" }],
      [],
      [{ id: "00000000-0000-4000-8000-0000000000a3" }],
      [{ id: CASE_ID, name: "基础检查", input: {}, expectations: [] }],
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
      [{ id: CASE_ID, name: "基础检查", input: {}, expectations: [] }],
      [],
    );

    await expect(prepareEvaluationRun(AGENT_ID)).resolves.toMatchObject({
      ok: true,
      cases: [{ id: CASE_ID, input: {}, expectations: [] }],
      resumed: false,
    });
    expect(mocks.insert).toHaveBeenCalledTimes(3);
    expect(mocks.insertedValues[1]).toEqual([expect.objectContaining({
      evaluationCaseId: CASE_ID,
      caseSnapshot: { name: "基础检查", input: {}, expectations: [] },
    })]);
  });

  it("补启未完成的验收时使用启动时冻结的输入", async () => {
    mocks.selectRows.push(
      [{ id: AGENT_ID, name: "客户助手" }],
      [{ id: "00000000-0000-4000-8000-0000000000a5", agentId: AGENT_ID, versionId: "00000000-0000-4000-8000-0000000000a3", status: "running" }],
      [{ id: CASE_ID, input: { question: "后改的问题" }, caseSnapshot: {
        name: "启动时样例", input: { question: "原问题" }, expectations: [],
      } }],
    );

    await expect(prepareEvaluationRun(AGENT_ID, "00000000-0000-4000-8000-0000000000a6"))
      .resolves.toMatchObject({ ok: true, cases: [{ id: CASE_ID, input: { question: "原问题" } }], resumed: true });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
