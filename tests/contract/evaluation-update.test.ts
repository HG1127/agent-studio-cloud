import { describe, expect, it } from "vitest";
import { EvaluationCaseArchiveInput, EvaluationCaseUpdateInput } from "@/contracts/evaluation";

describe("验收样例更新契约", () => {
  it("要求样例和助手标识都有效", () => {
    expect(EvaluationCaseUpdateInput.safeParse({
      agentId: "00000000-0000-4000-8000-000000000001",
      caseId: "00000000-0000-4000-8000-000000000002",
      name: "合同验收",
      input: { contract: "示例" },
      expectations: [{ path: "outputs.review", operator: "exists" }],
    }).success).toBe(true);
    expect(EvaluationCaseUpdateInput.safeParse({
      agentId: "bad", caseId: "bad", name: "合同验收", input: {}, expectations: [],
    }).success).toBe(false);
  });

  it("归档状态变更需要明确目标状态", () => {
    expect(EvaluationCaseArchiveInput.safeParse({
      agentId: "00000000-0000-4000-8000-000000000001",
      caseId: "00000000-0000-4000-8000-000000000002",
      archived: false,
    }).success).toBe(true);
    expect(EvaluationCaseArchiveInput.safeParse({
      agentId: "00000000-0000-4000-8000-000000000001",
      caseId: "00000000-0000-4000-8000-000000000002",
    }).success).toBe(false);
  });
});
