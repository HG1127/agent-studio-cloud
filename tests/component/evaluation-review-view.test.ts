import { describe, expect, it } from "vitest";
import { EvaluationReviewNavigation } from "@/features/agents/evaluation-review-navigation";
import { checkedEvaluationReport, evaluationBatchIssues, evaluationBatchVerdict, evaluationResultPage } from "@/features/agents/evaluation-review-view";
import { agentId, runId, evaluation, report, otherId } from "./evaluation-review-fixtures";

describe("验收保存记录的前端核对", () => {
  it.each([
    [{ ...evaluation, status: "running" as const }, "running"],
    [evaluation, "failed"],
    [{ ...evaluation, passedCount: 1, failedCount: 0 }, "passed"],
    [{ ...evaluation, totalCount: 0, passedCount: 0, failedCount: 0 }, "unknown"],
    [{ ...evaluation, totalCount: 2, passedCount: 1, failedCount: 0 }, "unknown"],
  ])("仅解释保存汇总，不补造评分 %j", (run, verdict) => {
    expect(evaluationBatchVerdict(run)).toBe(verdict);
  });
  it("一致的非空判定没有虚构的问题", () => {
    expect(evaluationBatchIssues(evaluation)).toEqual([]);
  });
  it("缺失、重复、计数不一致和未结束判定分别提示", () => {
    const issues = evaluationBatchIssues({ ...evaluation, totalCount: 3, passedCount: 1, results: [evaluation.results[0], { ...evaluation.results[0], status: "running" }] });
    expect(issues).toHaveLength(4);
  });
  it("按名称而非错误或内部编号检索，状态交集不改判定", () => {
    expect(evaluationResultPage(evaluation, EvaluationReviewNavigation.parse({ query: " 客户 ", status: "failed" })).visible).toEqual(evaluation.results);
    expect(evaluationResultPage(evaluation, EvaluationReviewNavigation.parse({ query: "预期" })).matching).toEqual([]);
    expect(evaluationResultPage(evaluation, EvaluationReviewNavigation.parse({ status: "passed" })).matching).toEqual([]);
    expect(evaluation.results[0].status).toBe("failed");
  });
  it("每页最多十条，越界空页不偷偷跳回第一页", () => {
    const results = Array.from({ length: 21 }, (_, index) => ({ ...evaluation.results[0], caseId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, caseName: `业务样例 ${index + 1}` }));
    const run = { ...evaluation, totalCount: 21, failedCount: 21, results };
    expect(evaluationResultPage(run, EvaluationReviewNavigation.parse({})).visible).toHaveLength(10);
    expect(evaluationResultPage(run, EvaluationReviewNavigation.parse({ samplePage: 3 })).visible).toHaveLength(1);
    const overflow = evaluationResultPage(run, EvaluationReviewNavigation.parse({ samplePage: 4 }));
    expect(overflow.visible).toEqual([]);
    expect(overflow.matching).toHaveLength(21);
  });
  it("校验真实报告契约和精确任务、助手、版本与验收来源", () => {
    expect(checkedEvaluationReport(report, { agentId, runId, version: 4 })).toEqual(report);
  });
  it.each([{ id: otherId }, { agentId: otherId }, { version: 5 }, { sourceType: "manual" }, { sourceType: "agent_call" }])("归属不符的报告不进入展示 %j", (change) => {
    expect(checkedEvaluationReport({ ...report, run: { ...report.run, ...change } }, { agentId, runId, version: 4 })).toBeNull();
  });
  it.each([{}, null, { ...report, formatVersion: 2 }, { ...report, steps: null }])("契约缺失或格式不符时不造报告 %j", (raw) => {
    expect(checkedEvaluationReport(raw, { agentId, runId, version: 4 })).toBeNull();
  });
});
