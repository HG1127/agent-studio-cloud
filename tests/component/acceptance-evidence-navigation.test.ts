import { describe, expect, it } from "vitest";
import { EvaluationReviewNavigation } from "@/features/agents/evaluation-review-navigation";
import { AcceptanceEvidenceSelection, AcceptanceOverviewScope, acceptanceEvidenceHref, acceptanceEvidenceNavigation, acceptanceHistoryHref, acceptanceOverviewHref, acceptanceReturnHref, acceptanceReturnNavigation, acceptanceRunDetailHref } from "@/features/quality/acceptance-evidence-navigation";
import { runReturnHref } from "@/features/runs/run-return-url";
import { agentId, batchId, caseId, runId } from "./evaluation-review-fixtures";

const overview = AcceptanceOverviewScope.parse({ query: "客户 & 合同", page: 3 });
const selection = AcceptanceEvidenceSelection.parse({ agentId, batchId, caseId, query: "缺少文字", status: "failed", samplePage: 2 });
const href = acceptanceEvidenceHref(overview, selection);

describe("验收总览的证据范围", () => {
  it("保存助手、批次、样例、两种搜索与分页，按原范围返回", () => {
    const url = new URL(href, "https://test.invalid");
    expect(url.hash).toBe("#evidence");
    const parsed = acceptanceEvidenceNavigation(Object.fromEntries(url.searchParams));
    expect(parsed).toEqual({ overview, selection, invalid: false });
    expect(acceptanceReturnHref(href)).toBe(href);
    expect(runReturnHref(href)).toBe(href);
    expect(acceptanceReturnNavigation(href)?.selection.agentId).toBe(agentId);
  });
  it("清除证据只保留总览的真实搜索与页码", () => {
    expect(acceptanceEvidenceHref(overview, AcceptanceEvidenceSelection.parse({}))).toBe("/acceptance?q=%E5%AE%A2%E6%88%B7+%26+%E5%90%88%E5%90%8C&page=3");
    expect(acceptanceOverviewHref({ query: "", page: 1 })).toBe("/acceptance");
  });
  it("历史组件的条件映射到中心，不伪造助手工作台分页", () => {
    const navigation = EvaluationReviewNavigation.parse({ batchId, caseId, query: selection.query, status: selection.status, samplePage: selection.samplePage, versionsPage: 8 });
    expect(acceptanceHistoryHref(agentId, navigation, overview)).toBe(href);
    const detail = new URL(acceptanceRunDetailHref(agentId, runId, navigation, overview), "https://test.invalid");
    expect(detail.pathname).toBe(`/runs/${runId}`);
    expect(detail.searchParams.get("from")).toBe(href);
  });
  it.each(["evidenceAgent", "evaluationBatch", "evaluationCase", "evaluationQuery", "evaluationStatus", "evaluationSamplePage"])("重复定位条件不替换成全部或另一对象 %s", (key) => {
    const valid = Object.fromEntries(new URL(href, "https://test.invalid").searchParams);
    const parsed = acceptanceEvidenceNavigation({ ...valid, [key]: [valid[key], valid[key]] });
    expect(parsed.invalid).toBe(true);
    expect(parsed.selection.batchId).toBeUndefined();
    expect(parsed.overview).toEqual(overview);
  });
  it.each([{ evidenceAgent: agentId }, { evaluationBatch: batchId }, { evaluationCase: caseId }, { evaluationQuery: "客户" }, { evaluationStatus: "failed" }, { evaluationSamplePage: "2" }, { evidenceAgent: "bad", evaluationBatch: batchId }, { evidenceAgent: agentId, evaluationBatch: batchId, evaluationSamplePage: "10001" }])("不完整或错误选择保持明确无效 %j", (query) => {
    expect(acceptanceEvidenceNavigation(query).invalid).toBe(true);
  });
  it.each([undefined, "/acceptance", "/acceptance#evidence", "/acceptance-other?x=1#evidence", "https://evil.invalid/acceptance", "//evil.invalid/acceptance", href.replace("#evidence", "#result"), href.replace("#evidence", "&extra=1#evidence"), href.replace("#evidence", "&page=3#evidence"), href.replace("#evidence", "&from=%2Fruns#evidence"), href.replace("evaluationCase", "unknownCase")])("不允许任意、不完整或递归返回 %s", (raw) => {
    expect(acceptanceReturnHref(raw)).toBeNull();
    expect(runReturnHref(raw)).toBe("/runs");
  });
  it("最长中文条件完整编码并有界返回，不只允许五百字符", () => {
    const long = acceptanceEvidenceHref({ query: "客".repeat(200), page: 10000 }, { ...selection, query: "案".repeat(100), samplePage: 10000 });
    expect(long.length).toBeGreaterThan(500);
    expect(long.length).toBeLessThan(4096);
    expect(acceptanceReturnHref(long)).toBe(long);
    expect(acceptanceReturnHref(long + "x".repeat(4096))).toBeNull();
  });
});
