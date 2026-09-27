export function releaseStatusForCaseCount(activeCaseCount: number): "candidate" | "production" {
  return activeCaseCount > 0 ? "candidate" : "production";
}

export function summarizeEvaluationResults(expectedCount: number, statuses: readonly string[]) {
  const passedCount = statuses.filter((status) => status === "passed").length;
  const failedCount = statuses.filter((status) => status === "failed").length;
  return {
    passedCount,
    failedCount,
    complete: expectedCount > 0
      && statuses.length === expectedCount
      && passedCount + failedCount === expectedCount,
  };
}

export function shouldPromoteEvaluation(summary: {
  totalCount: number;
  passedCount: number;
  failedCount: number;
}): boolean {
  return summary.totalCount > 0
    && summary.passedCount === summary.totalCount
    && summary.failedCount === 0;
}
