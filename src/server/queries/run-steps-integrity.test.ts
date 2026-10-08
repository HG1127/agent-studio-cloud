import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ orderBy: async () => mocks.rows }) }) }) },
}));

import { listRunSteps, listRunStepsForReport } from "@/server/queries/runs";

const RUN_ID = "00000000-0000-4000-8000-000000000011";
const WORKSPACE_ID = "00000000-0000-4000-8000-000000000012";

afterEach(() => {
  mocks.rows = [];
  vi.restoreAllMocks();
});

describe("运行步骤报告完整性", () => {
  it("保留有效历史步骤并报告跳过的损坏记录数量", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const valid = {
      id: "00000000-0000-4000-8000-000000000013",
      runId: RUN_ID,
      nodeId: "review",
      nodeTitle: "审核合同",
      nodeType: "ai",
      status: "succeeded",
      attempt: 1,
      output: { summary: "完成" },
      error: null,
      startedAt: new Date("2026-09-24T01:00:00.000Z"),
      finishedAt: new Date("2026-09-24T01:01:00.000Z"),
      createdAt: new Date("2026-09-24T01:00:00.000Z"),
      updatedAt: new Date("2026-09-24T01:01:00.000Z"),
    };
    mocks.rows = [valid, { ...valid, id: "bad-id" }];

    expect(await listRunStepsForReport(RUN_ID, WORKSPACE_ID)).toMatchObject({
      steps: [expect.objectContaining({ id: valid.id })],
      omittedCount: 1,
    });
    expect(await listRunSteps(RUN_ID, WORKSPACE_ID)).toEqual([expect.objectContaining({ id: valid.id })]);
    expect(warn).toHaveBeenCalledWith("[query] 已忽略 1 条不符合运行步骤契约的历史记录");
  });
});
