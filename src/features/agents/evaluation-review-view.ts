import type { EvaluationRunView } from "@/contracts/evaluation";
import { RunReportFile } from "@/contracts/run";
import type { EvaluationReviewNavigation } from "./evaluation-review-navigation";

export const EVALUATION_RESULT_PAGE_SIZE = 10;

export function evaluationBatchVerdict(run: EvaluationRunView): "running" | "failed" | "passed" | "unknown" {
  if (run.status === "running") return "running";
  if (run.failedCount > 0) return "failed";
  return run.totalCount > 0 && run.passedCount === run.totalCount ? "passed" : "unknown";
}

export function evaluationBatchIssues(run: EvaluationRunView): string[] {
  const issues: string[] = [];
  if (run.results.length !== run.totalCount) issues.push(`本次读到 ${run.results.length} 条样例判定，与汇总的 ${run.totalCount} 条不一致。`);
  if (new Set(run.results.map((result) => result.caseId)).size !== run.results.length) issues.push("存在重复样例记录，重复项不能用于定位运行证据。");
  const passed = run.results.filter((result) => result.status === "passed").length;
  const failed = run.results.filter((result) => result.status === "failed").length;
  if (passed !== run.passedCount || failed !== run.failedCount) issues.push("逐项判定与通过、失败汇总不一致，请重新读取后核对。");
  if (run.status === "completed" && (run.totalCount === 0 || run.results.some((result) => result.status === "running") || run.passedCount + run.failedCount !== run.totalCount)) issues.push("记录已结束，但尚未读到完整的非空判定，不能确认全部通过。");
  return issues;
}

export function evaluationResultPage(run: EvaluationRunView, navigation: EvaluationReviewNavigation) {
  const query = navigation.query.trim().toLocaleLowerCase("zh-CN");
  const matching = run.results.filter((result) => (navigation.status === "all" || result.status === navigation.status) && (!query || result.caseName.toLocaleLowerCase("zh-CN").includes(query)));
  const start = (navigation.samplePage - 1) * EVALUATION_RESULT_PAGE_SIZE;
  return { matching, visible: matching.slice(start, start + EVALUATION_RESULT_PAGE_SIZE), hasMore: start + EVALUATION_RESULT_PAGE_SIZE < matching.length, start };
}

export function checkedEvaluationReport(raw: unknown, expected: { agentId: string; runId: string; version: number }): RunReportFile | null {
  const parsed = RunReportFile.safeParse(raw);
  if (!parsed.success) return null;
  const run = parsed.data.run;
  return run.id === expected.runId && run.agentId === expected.agentId && run.version === expected.version && run.sourceType === "evaluation" ? parsed.data : null;
}
