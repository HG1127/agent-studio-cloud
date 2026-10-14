import { describe, expect, it } from "vitest";
import { EvaluationCaseCreateInput, EvaluationCaseSnapshot, EvaluationCaseUpdateInput, EvaluationResultSchema } from "@/contracts/evaluation";

const fields = { agentId: "00000000-0000-4000-8000-000000000001", name: "金额范围验收", input: {}, expectations: [] };
const schema = { type: "object", required: ["amount"], properties: { amount: { type: "number", minimum: 0, maximum: 100 } } };

describe("验收结果规则共享契约", () => {
  it("创建、修改和快照共享同一规则结构，省略与明确清除可区分", () => {
    expect(EvaluationCaseCreateInput.parse({ ...fields, resultSchema: schema }).resultSchema).toEqual(schema);
    expect(EvaluationCaseCreateInput.parse(fields)).not.toHaveProperty("resultSchema");
    expect(EvaluationCaseUpdateInput.parse({ ...fields, caseId: "00000000-0000-4000-8000-000000000002", expectedUpdatedAt: "2026-10-09T00:00:00Z", resultSchema: null }).resultSchema).toBeNull();
    const original = { name: fields.name, input: {}, expectations: [], resultSchema: structuredClone(schema) };
    const snapshot = EvaluationCaseSnapshot.parse(original);
    original.resultSchema.properties.amount.maximum = 1;
    expect(snapshot.resultSchema).toEqual(schema);
  });

  it.each([[], { type: "array" }, { type: "object", default: BigInt(1) }, { type: "object", description: "中".repeat(11_000) }])("拒绝非对象、不可保存和超限规则 %#", (value) => {
    expect(EvaluationResultSchema.safeParse(value).success).toBe(false);
  });

  it("明确清除不等于把空对象当作有效规则", () => {
    expect(EvaluationCaseCreateInput.safeParse({ ...fields, resultSchema: null }).success).toBe(true);
    expect(EvaluationCaseCreateInput.safeParse({ ...fields, resultSchema: {} }).success).toBe(false);
  });

  it("输入和规则分别有界也不能让合计超限的快照进入运行", () => {
    const value = { name: fields.name, input: { text: "x".repeat(97 * 1024) }, expectations: [], resultSchema: { type: "object", description: "x".repeat(31 * 1024) } };
    expect(EvaluationResultSchema.safeParse(value.resultSchema).success).toBe(true);
    expect(EvaluationCaseCreateInput.safeParse({ ...value, agentId: fields.agentId }).success).toBe(false);
    expect(EvaluationCaseSnapshot.safeParse(value).success).toBe(false);
    expect(EvaluationCaseSnapshot.safeParse({ ...value, resultSchema: null }).success).toBe(true);
  });
});
