import { describe, expect, it, vi } from "vitest";
import { evaluateExpectations, REGRESSION_EXPECTATION_REQUIRED } from "@/server/domain/evaluation";
import { EvaluationExpectation } from "@/contracts/evaluation";

describe("自动验收条件", () => {
  it("按已接受的字段契约读取订单数组，保留零金额和否定值", () => {
    const expectations = [
      { path: "订单.0.金额", operator: "equals", value: 0 },
      { path: "订单.0.已确认", operator: "equals", value: false },
      { path: "订单.0.标签.1", operator: "contains", value: "到货" },
      { path: "订单.0.金额", operator: "exists" },
    ].map((expectation) => EvaluationExpectation.parse(expectation));
    expect(evaluateExpectations({ 订单: [{ 金额: 0, 已确认: false, 标签: ["核对", "到货确认"] }] }, expectations))
      .toEqual({ passed: true, errors: [] });
  });

  it("可交替读取对象与多层数组，数组元素为空值时存在检查仍失败", () => {
    expect(evaluateExpectations({ batches: [[{ items: [null, { name: "通过" }] }]] }, [
      { path: "batches.0.0.items.1.name", operator: "equals", value: "通过" },
    ])).toEqual({ passed: true, errors: [] });
    expect(evaluateExpectations({ rows: [null] }, [{ path: "rows.0", operator: "exists" }]))
      .toEqual({ passed: false, errors: ["rows.0不存在"] });
  });

  it("读取数组元素后仍按实际业务值判定，不把取到字段当作通过", () => {
    expect(evaluateExpectations({ items: [{ amount: 10, approved: true }] }, [
      { path: "items.0.amount", operator: "equals", value: 0 },
      { path: "items.0.approved", operator: "equals", value: false },
    ])).toEqual({ passed: false, errors: ["items.0.amount与预期不一致", "items.0.approved与预期不一致"] });
  });

  it.each(["length", "01", "-1", "1.0", "1e0", "+0", "4294967295", "9007199254740993", "toString", "constructor", "__proto__", "*"])("数组路径 %s 不读取元数据、别名索引或原型", (key) => {
    const rows = Object.assign([{ amount: 0 }], { "01": { amount: 1 }, "-1": { amount: 2 } });
    expect(evaluateExpectations({ rows }, [{ path: `rows.${key}`, operator: "exists" }]).passed).toBe(false);
  });

  it("数组空槽与继承索引不是业务元素，对象的数字键仍可读取", () => {
    const rows = new Array(1); Object.setPrototypeOf(rows, { 0: { amount: 99 } });
    expect(evaluateExpectations({ rows }, [{ path: "rows.0.amount", operator: "exists" }]).passed).toBe(false);
    expect(evaluateExpectations({ values: { "01": { amount: 0 } } }, [{ path: "values.01.amount", operator: "equals", value: 0 }]))
      .toEqual({ passed: true, errors: [] });
  });

  it("不执行字段或数组索引的访问器", () => {
    const access = vi.fn(() => "不应执行");
    const row = Object.defineProperty({}, "amount", { get: access });
    const rows: unknown[] = [];
    Object.defineProperty(rows, "0", { get: access });
    expect(evaluateExpectations({ row, rows }, [{ path: "row.amount", operator: "exists" }, { path: "rows.0", operator: "exists" }]).passed).toBe(false);
    expect(access).not.toHaveBeenCalled();
  });

  it("整个数组仍可用深比较验收，不改写结果或条件", () => {
    const result = { items: [{ amount: 0, approved: false }] }, before = JSON.stringify(result);
    const expectations = [{ path: "items", operator: "equals" as const, value: [{ approved: false, amount: 0 }] }];
    expect(evaluateExpectations(result, expectations)).toEqual({ passed: true, errors: [] });
    expect(JSON.stringify(result)).toBe(before);
  });

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
