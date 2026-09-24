import { describe, expect, it } from "vitest";
import { releaseStatusForCaseCount, shouldPromoteEvaluation } from "@/server/domain/release-gate";

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
});
