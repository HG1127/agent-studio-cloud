import { describe, expect, it } from "vitest";
import { EvaluationReviewNavigation, evaluationReviewNavigation, evaluationReviewHref, evaluationReturnHref, evaluationRunDetailHref } from "@/features/agents/evaluation-review-navigation";
import { runReturnHref } from "@/features/runs/run-return-url";
import { agentId, batchId, caseId, runId } from "./evaluation-review-fixtures";

const state = EvaluationReviewNavigation.parse({ batchId, caseId, query: "客户 续约", status: "failed", samplePage: 2, versionsPage: 3, archivedCasesPage: 4, evaluationRunsPage: 5 });
const href = evaluationReviewHref(agentId, state);

describe("验收证据安全往返", () => {
  it("没有定位时不补造批次和样例", () => {
    expect(evaluationReviewNavigation({})).toEqual({ state: EvaluationReviewNavigation.parse({}), invalid: false });
  });
  it("保留三种列表页码、批次、样例和筛选，规范化返回", () => {
    const url = new URL(href, "https://local.invalid");
    expect(evaluationReviewNavigation(Object.fromEntries(url.searchParams))).toEqual({ state, invalid: false });
    expect(evaluationReturnHref(href)).toBe(href);
    expect(runReturnHref(href)).toBe(href);
    const detail = new URL(evaluationRunDetailHref(agentId, runId, state), url);
    expect(detail.pathname).toBe(`/runs/${runId}`);
    expect(detail.searchParams.get("from")).toBe(href);
  });
  it.each([
    { evaluationBatch: "" }, { evaluationBatch: "constructor" }, { evaluationCase: caseId },
    { evaluationBatch: [batchId, batchId] }, { evaluationBatch: batchId, evaluationCase: [caseId, caseId] },
    { evaluationQuery: "x".repeat(101) }, { evaluationStatus: "completed" },
    { evaluationSamplePage: "0" }, { evaluationSamplePage: "10001" }, { evaluationRunsPage: "-1" },
    { versionsPage: ["1", "2"] }, { archivedCasesPage: "" },
  ])("无效、重复或越界参数不静默选其他证据 %j", (query) => {
    expect(evaluationReviewNavigation(query).invalid).toBe(true);
    expect(evaluationReviewNavigation(query).state.batchId).toBeUndefined();
  });
  it.each([
    `https://outside.invalid${href}`, `//outside.invalid${href}`, href.replace("#evaluation", ""),
    href.replace("#evaluation", "#workflow"), href.replace(agentId, "not-an-agent"),
    href.replace("#evaluation", `&evaluationCase=${caseId}#evaluation`),
    href.replace("#evaluation", "&from=/runs#evaluation"),
    href.replace("#evaluation", "&redirect=https://outside.invalid#evaluation"),
    href.replace("#evaluation", "&unknown=1#evaluation"),
    evaluationReviewHref(agentId, EvaluationReviewNavigation.parse({ batchId })),
  ])("拒绝外站、递归、歧义或未选样例的返回 %s", (raw) => {
    expect(evaluationReturnHref(raw)).toBeNull();
    expect(runReturnHref(raw)).toBe("/runs");
  });
  it("构造器拒绝不合法的助手、任务及无批次样例", () => {
    expect(() => evaluationReviewHref("../runs", state)).toThrow();
    expect(() => evaluationRunDetailHref(agentId, "../elsewhere", state)).toThrow();
    expect(() => EvaluationReviewNavigation.parse({ caseId })).toThrow();
  });
});
