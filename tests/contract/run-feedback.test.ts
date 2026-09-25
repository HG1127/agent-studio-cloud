import { describe, expect, it } from "vitest";
import { RunFeedbackSaveInput, RunFeedbackView } from "@/contracts/run-feedback";

const RUN_ID = "00000000-0000-4000-8000-000000000001";

describe("运行反馈契约", () => {
  it("有用反馈可以不填写说明", () => {
    expect(RunFeedbackSaveInput.parse({ runId: RUN_ID, rating: "useful" })).toEqual({
      runId: RUN_ID,
      rating: "useful",
      note: null,
    });
  });

  it("需要改进时必须填写可行动说明", () => {
    const result = RunFeedbackSaveInput.safeParse({ runId: RUN_ID, rating: "needs_improvement", note: "  " });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toBe("请说明这次结果需要改进的地方");
  });

  it("读取反馈时校验回归样例关联", () => {
    expect(RunFeedbackView.safeParse({
      id: RUN_ID,
      runId: RUN_ID,
      rating: "needs_improvement",
      note: "缺少依据",
      evaluationCaseId: "not-a-uuid",
      updatedAt: "2026-09-26T00:00:00.000Z",
    }).success).toBe(false);
  });
});
