import { describe, expect, it } from "vitest";
import { runFeedbackMatches } from "@/server/domain/run-feedback";

describe("运行反馈重复请求识别", () => {
  it("评分和说明完全相同时复用已有反馈", () => {
    expect(runFeedbackMatches(
      { rating: "needs_improvement", note: "缺少依据" },
      { rating: "needs_improvement", note: "缺少依据" },
    )).toBe(true);
  });

  it("评分或说明变化时继续保存", () => {
    expect(runFeedbackMatches(
      { rating: "useful", note: null },
      { rating: "needs_improvement", note: "缺少依据" },
    )).toBe(false);
    expect(runFeedbackMatches(
      { rating: "needs_improvement", note: "旧说明" },
      { rating: "needs_improvement", note: "新说明" },
    )).toBe(false);
  });
});
