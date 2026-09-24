export function releaseStatusForCaseCount(activeCaseCount: number): "candidate" | "production" {
  return activeCaseCount > 0 ? "candidate" : "production";
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
