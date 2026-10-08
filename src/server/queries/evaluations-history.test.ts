import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rows: [] as unknown[][] }));

vi.mock("@/lib/db", () => ({ db: {
  select: () => {
    const rows = mocks.rows.shift() ?? [];
    const query = {
      from: () => query,
      innerJoin: () => query,
      leftJoin: () => query,
      where: () => query,
      orderBy: () => query,
      limit: () => query,
      offset: async () => rows,
      then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
    };
    return query;
  },
} }));

import { listEvaluationRuns } from "@/server/queries/evaluations";

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const AGENT_ID = "00000000-0000-4000-8000-000000000002";
const EVALUATION_ID = "00000000-0000-4000-8000-000000000003";
const CASE_ID = "00000000-0000-4000-8000-000000000004";
const RUN_ID = "00000000-0000-4000-8000-000000000005";

beforeEach(() => { mocks.rows = []; });

describe("历史验收记录", () => {
  it("展示启动时冻结的样例名称，旧记录仍能回退到当前名称", async () => {
    const evaluation = {
      id: EVALUATION_ID, status: "completed", totalCount: 2, passedCount: 2, failedCount: 0,
      startedAt: new Date("2026-09-27T00:00:00.000Z"), finishedAt: new Date("2026-09-27T00:01:00.000Z"),
    };
    mocks.rows = [
      [{ evaluation, version: 1 }],
      [
        { result: { evaluationRunId: EVALUATION_ID, evaluationCaseId: CASE_ID, caseSnapshot: {
          name: "启动时名称", input: {}, expectations: [],
        }, status: "passed", error: null, runId: RUN_ID }, caseName: "后来修改的名称" },
        { result: { evaluationRunId: EVALUATION_ID, evaluationCaseId: "00000000-0000-4000-8000-000000000006", caseSnapshot: null,
          status: "passed", error: null, runId: RUN_ID }, caseName: "旧记录名称" },
      ],
    ];

    const [view] = await listEvaluationRuns(AGENT_ID, WORKSPACE_ID);

    expect(view.results.map((result) => result.caseName)).toEqual(["启动时名称", "旧记录名称"]);
  });
});
