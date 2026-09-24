import { describe, expect, it } from "vitest";
import { EvaluationExpectation } from "@/contracts/evaluation";
import { evaluateExpectations } from "@/server/domain/evaluation";

describe("评估断言", () => {
  it("支持路径相等、文本包含与存在检查", () => {
    const result = { summary: { status: "ok", text: "客户续约方案已完成" } };
    expect(evaluateExpectations(result, [
      { path: "summary.status", operator: "equals", value: "ok" },
      { path: "summary.text", operator: "contains", value: "续约方案" },
      { path: "summary", operator: "exists" },
    ])).toEqual({ passed: true, errors: [] });
  });

  it("返回面向用户的失败原因", () => {
    const outcome = evaluateExpectations({ summary: "已完成" }, [
      { path: "summary", operator: "contains", value: "已发送" },
      { path: "receipt", operator: "exists" },
    ]);
    expect(outcome.passed).toBe(false);
    expect(outcome.errors).toEqual(["summary未包含“已发送”", "receipt不存在"]);
  });

  it("包含检查遇到不存在的字段时返回失败而不是抛出异常", () => {
    expect(evaluateExpectations({}, [
      { path: "missing.text", operator: "contains", value: "完成" },
    ])).toEqual({ passed: false, errors: ["missing.text未包含“完成”"] });
  });

  it("契约拒绝空的包含预期和缺省的等于预期", () => {
    expect(EvaluationExpectation.safeParse({ path: "result", operator: "contains", value: " " }).success).toBe(false);
    expect(EvaluationExpectation.safeParse({ path: "result", operator: "equals" }).success).toBe(false);
    expect(EvaluationExpectation.safeParse({ path: "result", operator: "exists" }).success).toBe(true);
  });
});
