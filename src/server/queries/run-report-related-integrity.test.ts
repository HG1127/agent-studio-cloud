import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rows: [] as unknown[] }));

vi.mock("@/lib/db", () => {
  const query = {
    from: () => query,
    leftJoin: () => query,
    where: () => query,
    orderBy: async () => mocks.rows,
    limit: async () => mocks.rows,
  };
  return { db: { select: () => query } };
});

import { listApprovalsForReport } from "@/server/queries/runs";
import { getRunFeedbackForReport } from "@/server/queries/run-feedback";

const RUN_ID = "00000000-0000-4000-8000-000000000011";
const WORKSPACE_ID = "00000000-0000-4000-8000-000000000012";

afterEach(() => {
  mocks.rows = [];
  vi.restoreAllMocks();
});

describe("运行报告关联记录完整性", () => {
  it("统计已略过的损坏确认记录", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const valid = {
      id: "00000000-0000-4000-8000-000000000013",
      runId: RUN_ID,
      nodeId: "approve",
      nodeTitle: "人工确认",
      status: "approved",
      role: "负责人",
      reason: "审核通过",
      payload: { review: null },
      note: null,
      decidedAt: new Date("2026-09-24T01:00:00.000Z"),
    };
    mocks.rows = [valid, { ...valid, id: "bad-id" }];

    expect(await listApprovalsForReport(RUN_ID, WORKSPACE_ID)).toMatchObject({
      approvals: [expect.objectContaining({ id: valid.id })],
      omittedCount: 1,
    });
    expect(warn).toHaveBeenCalledWith("[query] 已忽略 1 条不符合确认记录契约的历史记录");
  });

  it("区分没有反馈和已有但不符合契约的反馈", async () => {
    expect(await getRunFeedbackForReport(RUN_ID, WORKSPACE_ID)).toEqual({ feedback: null, omittedCount: 0 });
    const valid = {
      id: "00000000-0000-4000-8000-000000000014",
      runId: RUN_ID,
      rating: "needs_improvement",
      note: "需要补充依据",
      updatedAt: new Date("2026-09-24T01:00:00.000Z"),
    };
    mocks.rows = [{ feedback: valid, activeCaseId: null }];
    expect(await getRunFeedbackForReport(RUN_ID, WORKSPACE_ID)).toMatchObject({
      feedback: expect.objectContaining({ id: valid.id }), omittedCount: 0,
    });
    mocks.rows = [{ feedback: { ...valid, rating: "unknown" }, activeCaseId: null }];
    expect(await getRunFeedbackForReport(RUN_ID, WORKSPACE_ID)).toEqual({ feedback: null, omittedCount: 1 });
  });
});
