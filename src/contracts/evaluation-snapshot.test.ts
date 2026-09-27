import { describe, expect, it } from "vitest";
import { EvaluationCaseSnapshot } from "@/contracts/evaluation";

describe("验收样例快照契约", () => {
  it("冻结名称、输入和条件并拒绝不完整条件", () => {
    expect(EvaluationCaseSnapshot.parse({
      name: "基础样例",
      input: { question: "原问题" },
      expectations: [{ path: "answer", operator: "equals", value: "通过" }],
    })).toEqual({
      name: "基础样例",
      input: { question: "原问题" },
      expectations: [{ path: "answer", operator: "equals", value: "通过" }],
    });
    expect(EvaluationCaseSnapshot.safeParse({
      name: "基础样例", input: {}, expectations: [{ path: "answer", operator: "equals" }],
    }).success).toBe(false);
  });
});
