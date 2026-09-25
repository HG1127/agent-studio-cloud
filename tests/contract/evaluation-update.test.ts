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
      expectedUpdatedAt: "2026-09-25T00:00:00.000Z",
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

  it("验收输入与预期值必须是安全有界的 JSON", () => {
    const base = {
      agentId: "00000000-0000-4000-8000-000000000001",
      caseId: "00000000-0000-4000-8000-000000000002",
      name: "合同验收",
      input: { contract: "示例" },
      expectations: [],
      expectedUpdatedAt: "2026-09-25T00:00:00.000Z",
    };
    expect(EvaluationCaseUpdateInput.safeParse({ ...base, input: { amount: BigInt(1) } }).success).toBe(false);
    expect(EvaluationCaseUpdateInput.safeParse({
      ...base,
      expectations: [{ path: "result", operator: "equals", value: BigInt(1) }],
    }).success).toBe(false);
    expect(EvaluationCaseUpdateInput.safeParse({ ...base, input: { text: "中".repeat(100 * 1024) } }).success).toBe(false);
    expect(EvaluationCaseUpdateInput.safeParse({ ...base, expectedUpdatedAt: "not-a-date" }).success).toBe(false);
  });
});
