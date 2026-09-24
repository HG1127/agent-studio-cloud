import { describe, expect, it } from "vitest";
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
});
