import { describe, expect, it } from "vitest";
import { validateJsonObjectSchema } from "@/server/domain/json-schema";

describe("外部消息字段校验", () => {
  const schema = {
    type: "object",
    required: ["complete", "customer"],
    properties: {
      complete: { type: "boolean" },
      customer: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" }, score: { type: "number" } },
      },
      tags: { type: "array", items: { type: "string" } },
      state: { enum: ["ready", "cancelled"] },
    },
  };

  it("接受满足字段结构的消息", () => {
    expect(validateJsonObjectSchema({ complete: true, customer: { id: "c-1", score: 92 }, tags: ["重点"], state: "ready" }, schema)).toBeNull();
  });

  it("拒绝缺失、类型错误和枚举外的值", () => {
    expect(validateJsonObjectSchema({ complete: true }, schema)).toBe("消息.customer为必填字段");
    expect(validateJsonObjectSchema({ complete: "yes", customer: { id: "c-1" } }, schema)).toContain("消息.complete类型不正确");
    expect(validateJsonObjectSchema({ complete: true, customer: { id: "c-1" }, state: "unknown" }, schema)).toBe("消息.state不是允许的值");
  });

  it("拒绝超过支持深度的字段结构而不是静默跳过校验", () => {
    let nestedSchema: Record<string, unknown> = { type: "string" };
    let nestedPayload: Record<string, unknown> = { value: "ok" };
    for (let depth = 0; depth < 10; depth += 1) {
      nestedSchema = { type: "object", required: ["value"], properties: { value: nestedSchema } };
      nestedPayload = { value: nestedPayload };
    }

    expect(validateJsonObjectSchema(nestedPayload, nestedSchema)).toContain("字段结构层级超过 8 层");
  });

  it("执行文字长度、格式、数值范围、数组数量和禁止多余字段约束", () => {
    const constrained = {
      type: "object",
      additionalProperties: false,
      required: ["code", "score", "tags"],
      properties: {
        code: { type: "string", minLength: 3, maxLength: 5, pattern: "^[A-Z]+$" },
        score: { type: "number", minimum: 0, exclusiveMaximum: 100 },
        tags: { type: "array", minItems: 1, maxItems: 2, items: { type: "string" } },
      },
    };
    expect(validateJsonObjectSchema({ code: "ABC", score: 99, tags: ["重点"] }, constrained)).toBeNull();
    expect(validateJsonObjectSchema({ code: "ab", score: 99, tags: ["重点"] }, constrained)).toContain("长度不能少于");
    expect(validateJsonObjectSchema({ code: "ABC", score: 100, tags: ["重点"] }, constrained)).toContain("必须小于 100");
    expect(validateJsonObjectSchema({ code: "ABC", score: 99, tags: [] }, constrained)).toContain("至少需要 1 项");
    expect(validateJsonObjectSchema({ code: "ABC", score: 99, tags: ["重点"], extra: true }, constrained)).toContain("extra不是允许的字段");
  });

  it("拒绝不支持或格式错误的契约规则", () => {
    expect(validateJsonObjectSchema({}, { type: "object", allOf: [] })).toContain("暂不支持的规则“allOf”");
    expect(validateJsonObjectSchema({}, { type: "object", properties: { code: { type: "string", pattern: "[" } } })).toContain("不是有效正则表达式");
    expect(validateJsonObjectSchema({}, { type: "object", maxProperties: -1 })).toContain("必须是非负整数");
  });

  it("限制外部消息正则和字段契约复杂度", () => {
    expect(validateJsonObjectSchema({}, {
      type: "object",
      properties: { code: { type: "string", pattern: "(a+)+$", maxLength: 100 } },
    })).toContain("只能使用简单文字");
    expect(validateJsonObjectSchema({}, {
      type: "object",
      properties: { code: { type: "string", pattern: "^[A-Z]+$" } },
    })).toContain("必须设置不超过 4096 的 maxLength");
    expect(validateJsonObjectSchema({}, {
      type: "object",
      properties: Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`field_${index}`, { type: "string" }])),
    })).toContain("不能超过 100 个字段");
  });
});
