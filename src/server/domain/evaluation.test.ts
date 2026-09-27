import { describe, expect, it } from "vitest";
import { evaluateExpectations, REGRESSION_EXPECTATION_REQUIRED } from "@/server/domain/evaluation";

describe("自动验收条件", () => {
  it("普通空条件样例仍可用作流程完成检查", () => {
    expect(evaluateExpectations({ answer: "完成" }, [])).toEqual({ passed: true, errors: [] });
  });

  it("改进反馈衍生的空条件回归样例不能通过发布门禁", () => {
    expect(evaluateExpectations({ answer: "仍然错误" }, [], { feedbackRegression: true }))
      .toEqual({ passed: false, errors: [REGRESSION_EXPECTATION_REQUIRED] });
  });

  it("回归样例补齐条件后按实际结果判定", () => {
    const expectations = [{ path: "answer", operator: "equals" as const, value: "正确答案" }];
    expect(evaluateExpectations({ answer: "仍然错误" }, expectations, { feedbackRegression: true }).passed).toBe(false);
    expect(evaluateExpectations({ answer: "正确答案" }, expectations, { feedbackRegression: true }).passed).toBe(true);
  });

  it("JSON 数字负零满足数值零的等于条件", () => {
    expect(evaluateExpectations({ amount: -0 }, [{ path: "amount", operator: "equals", value: 0 }]))
      .toEqual({ passed: true, errors: [] });
  });
});
