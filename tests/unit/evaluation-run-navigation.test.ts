import { describe, expect, it } from "vitest";
import { evaluationRunReturnHref } from "@/features/runs/evaluation-run-navigation";
import { EvaluationReviewNavigation, evaluationReviewHref } from "@/features/agents/evaluation-review-navigation";
import { acceptanceHistoryHref } from "@/features/quality/acceptance-evidence-navigation";

const agentId = "00000000-0000-4000-8000-000000000002";
const otherId = "00000000-0000-4000-8000-000000000003";
const navigation = EvaluationReviewNavigation.parse({
  batchId: "00000000-0000-4000-8000-000000000004", caseId: "00000000-0000-4000-8000-000000000005",
  query: "原样例", status: "failed", samplePage: 3, versionsPage: 2, archivedCasesPage: 4, evaluationRunsPage: 5,
});

describe("验收来源任务的只读返回范围", () => {
  it("完整同助手工作台位置保留批次、样例、筛选和分页", () => {
    const original = evaluationReviewHref(agentId, navigation);
    expect(evaluationRunReturnHref(agentId, original)).toBe(original);
  });
  it("完整同助手中心位置保留清单与逐项范围，不改为最新批次", () => {
    const original = acceptanceHistoryHref(agentId, navigation, { query: "合同", page: 3 });
    expect(evaluationRunReturnHref(agentId, original)).toBe(original);
  });
  it.each([
    evaluationReviewHref(otherId, navigation),
    acceptanceHistoryHref(otherId, navigation, { query: "另一位助手", page: 2 }),
    "https://example.invalid/acceptance#evidence", "//example.invalid/acceptance#evidence", "javascript:alert(1)",
    "/runs/00000000-0000-4000-8000-000000000006", "/agents/not-an-agent#evaluation",
    evaluationReviewHref(agentId, navigation).replace("#evaluation", "#versions"),
    evaluationReviewHref(agentId, navigation).replace("#evaluation", "&evaluationCase=" + navigation.caseId + "#evaluation"),
    evaluationReviewHref(agentId, navigation).replace("#evaluation", "&unknown=1#evaluation"),
    acceptanceHistoryHref(agentId, navigation, { query: "", page: 1 }).replace("#evidence", "&page=2&page=3#evidence"),
    "/acceptance?evidenceAgent=" + agentId + "#evidence",
  ])("外部、错配或不完整位置不用作验收范围：%s", (original) => {
    expect(evaluationRunReturnHref(agentId, original)).toBe(`/agents/${agentId}#evaluation`);
  });
  it("无来源只定位实际助手的验收区，不补造批次或样例", () => {
    expect(evaluationRunReturnHref(agentId)).toBe(`/agents/${agentId}#evaluation`);
  });
  it.each(["", "unknown-agent", "/agents/" + agentId])("实际助手信息无效时不生成返回入口：%s", (id) => {
    expect(evaluationRunReturnHref(id, evaluationReviewHref(agentId, navigation))).toBeNull();
  });
});
