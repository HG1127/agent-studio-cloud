import { describe, expect, it } from "vitest";
import { releaseStatusForCaseCount, shouldPromoteEvaluation, summarizeEvaluationResults } from "@/server/domain/release-gate";

describe("版本验收门禁", () => {
  it("没有验收样例时直接上线，有样例时先成为候选版本", () => {
    expect(releaseStatusForCaseCount(0)).toBe("production");
    expect(releaseStatusForCaseCount(2)).toBe("candidate");
  });

  it("只有全部样例通过才允许候选版本上线", () => {
    expect(shouldPromoteEvaluation({ totalCount: 2, passedCount: 2, failedCount: 0 })).toBe(true);
    expect(shouldPromoteEvaluation({ totalCount: 2, passedCount: 1, failedCount: 1 })).toBe(false);
    expect(shouldPromoteEvaluation({ totalCount: 0, passedCount: 0, failedCount: 0 })).toBe(false);
  });

  it("缺失或多出的结果行不能使整轮验收完成", () => {
    expect(summarizeEvaluationResults(2, ["passed"])).toEqual({ passedCount: 1, failedCount: 0, complete: false });
    expect(summarizeEvaluationResults(1, ["passed", "passed"])).toEqual({ passedCount: 2, failedCount: 0, complete: false });
    expect(summarizeEvaluationResults(2, ["passed", "running"])).toEqual({ passedCount: 1, failedCount: 0, complete: false });
    expect(summarizeEvaluationResults(2, ["passed", "failed"])).toEqual({ passedCount: 1, failedCount: 1, complete: true });
    expect(summarizeEvaluationResults(2, ["passed", "passed"])).toEqual({ passedCount: 2, failedCount: 0, complete: true });
  });
});
