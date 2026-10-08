import { describe, expect, it } from "vitest";
import { EvaluationResultSchema } from "@/contracts/evaluation";
import { evaluateExpectations, REGRESSION_EXPECTATION_REQUIRED } from "@/server/domain/evaluation";
import { evaluationResultSchemaIssue } from "@/server/domain/evaluation-result-schema";

const resultSchema = EvaluationResultSchema.parse({
  type: "object", required: ["orders"], additionalProperties: false,
  properties: { orders: { type: "array", minItems: 1, maxItems: 2, items: {
    type: "object", required: ["amount", "approved"], additionalProperties: false,
    properties: { amount: { type: "number", minimum: 0, maximum: 100 }, approved: { type: "boolean", const: false } },
  } } },
});

describe("业务结果字段规则", () => {
  it("有效规则和未配置规则可接受，凭据字段名本身不是秘密", () => {
    expect(evaluationResultSchemaIssue(resultSchema)).toBeNull();
    expect(evaluationResultSchemaIssue(undefined)).toBeNull();
    expect(evaluationResultSchemaIssue(null)).toBeNull();
    expect(evaluationResultSchemaIssue({ type: "object", properties: { apiKey: { type: "string" } } })).toBeNull();
  });

  it.each([
    { type: "array" }, { type: "object", $ref: "https://example.com/schema" },
    { type: "object", properties: { amount: { type: "number", minimum: 10, maximum: 1 } } },
    { type: "object", properties: { rows: { type: "array", minItems: 3, maxItems: 1 } } },
    { type: "object", properties: { name: { type: "string", pattern: "(a+)+", maxLength: 100 } } },
  ])("不接受无效、不支持或危险的字段规则 %#", (schema) => {
    expect(evaluationResultSchemaIssue(schema)).toBeTruthy();
  });

  it.each([
    { type: "object", description: "Bearer evaluation-secret-value" },
    { type: "object", const: { apiKey: "short" } },
    { type: "object", examples: [{ password: "short" }] },
    { type: "object", properties: { receipt: { type: "object", default: { authorization: "short" } } } },
  ])("拒绝凭据字面量，不把脱敏后改变含义的规则保存为有效规则 %#", (schema) => {
    expect(evaluationResultSchemaIssue(schema)).toContain("不能包含凭据");
  });

  it("范围与条数校验保留零金额和否定值，可作为回归验收条件", () => {
    expect(evaluateExpectations({ orders: [{ amount: 0, approved: false }] }, [], { resultSchema, feedbackRegression: true }))
      .toEqual({ passed: true, errors: [] });
  });

  it.each([
    { orders: [] }, { orders: [{ amount: -1, approved: false }] }, { orders: [{ amount: 101, approved: false }] },
    { orders: [{ amount: "0", approved: false }] }, { orders: [{ amount: 0, approved: true }] },
    { orders: [{ approved: false }] }, { orders: [{ amount: 0, approved: false, extra: 1 }] },
    { orders: Array.from({ length: 3 }, () => ({ amount: 0, approved: false })) },
  ])("断言为空时也不能把不符合字段规则的业务结果判为通过 %#", (result) => {
    const verdict = evaluateExpectations(result, [], { resultSchema });
    expect(verdict.passed).toBe(false);
    expect(verdict.errors[0]).toMatch(/^结果/);
  });

  it("结果字段规则与原有断言必须同时通过，无规则的空回归条件仍拒绝", () => {
    expect(evaluateExpectations({ orders: [{ amount: 10, approved: false }] }, [{ path: "orders.0.amount", operator: "equals", value: 0 }], { resultSchema }).passed).toBe(false);
    expect(evaluateExpectations({ orders: [] }, [], { resultSchema: null, feedbackRegression: true }))
      .toEqual({ passed: false, errors: [REGRESSION_EXPECTATION_REQUIRED] });
    expect(evaluateExpectations({ orders: [] }, [], { resultSchema: { type: "object", $ref: "unknown" } }).passed).toBe(false);
  });
});
