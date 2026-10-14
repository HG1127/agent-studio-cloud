import { describe, expect, it } from "vitest";
import { EvaluationCaseArchiveInput, EvaluationCaseUpdateInput, EvaluationExpectation } from "@/contracts/evaluation";

describe("验收样例更新契约", () => {
  it("数组元素验收沿用同一共享字段契约，零值和否定值不丢失", () => {
    expect(EvaluationExpectation.parse({ path: "订单.0.金额", operator: "equals", value: 0 }))
      .toEqual({ path: "订单.0.金额", operator: "equals", value: 0 });
    expect(EvaluationExpectation.parse({ path: "订单.0.已确认", operator: "equals", value: false }))
      .toEqual({ path: "订单.0.已确认", operator: "equals", value: false });
    expect(EvaluationExpectation.safeParse({ path: "批次.0.0.明细.1.名称", operator: "exists" }).success).toBe(true);
  });

  it.each(["订单..金额", ".订单", "订单.", "订单.0.__proto__.金额", "订单.0.constructor", "订单.0.prototype"])("继续拒绝非法或原型路径 %s", (path) => {
    expect(EvaluationExpectation.safeParse({ path, operator: "exists" }).success).toBe(false);
  });

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
