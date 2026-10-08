import { describe, expect, it } from "vitest";
import { validateJsonObjectSchema, validateJsonSchemaDefinition } from "@/server/domain/json-schema";

function patternedField(pattern: string) {
  return { type: "object", properties: { code: { type: "string", pattern, maxLength: 80 } } };
}

describe("消息契约正则的回溯限制", () => {
  it.each([
    "^a+a+a+a+a+a+b$",
    "^a*a*b$",
    "^a?a?b$",
    "^a{1,80}a{1,80}b$",
    "^a{1,}a{1,}b$",
    "^a+?a+?b$",
    "^a??a??b$",
    "^[A-Z]+[0-9]+$",
  ])("多个可变长度重复规则在匹配前被拒绝：%s", (pattern) => {
    const schema = patternedField(pattern);
    expect(validateJsonSchemaDefinition(schema)).toContain("最多允许一处不固定数量规则");
    expect(validateJsonObjectSchema({}, schema)).toContain("最多允许一处不固定数量规则");
  });

  it.each([
    { pattern: "^[A-Z]{2}[0-9]+$", value: "AB123" },
    { pattern: "^单-[0-9]{2,4}$", value: "单-123" },
    { pattern: "^a{2,2}?b{1,1}?$", value: "aab" },
    { pattern: "^a{02,2}b{1,01}$", value: "aab" },
    { pattern: "^\\++\\?{2}$", value: "+++??" },
    { pattern: "^[+*?{}]{2}[0-9]+$", value: "?+123" },
    { pattern: "^[\\]]+[?*+]{2}$", value: "]]?+" },
    { pattern: "^.*?end$", value: "prefix end" },
    { pattern: "^\\{[0-9]+\\}$", value: "{123}" },
  ])("保留固定数量、字面符号和单处可变重复：$pattern", ({ pattern, value }) => {
    const schema = patternedField(pattern);
    expect(validateJsonSchemaDefinition(schema)).toBeNull();
    expect(validateJsonObjectSchema({ code: value }, schema)).toBeNull();
  });
});

describe("结构化消息契约", () => {
  it("const 数值零接收 JSON 输入中的负零", () => {
    const schema = {
      type: "object",
      required: ["amount"],
      properties: { amount: { const: 0 } },
    };
    expect(validateJsonSchemaDefinition(schema)).toBeNull();
    expect(validateJsonObjectSchema(JSON.parse('{"amount":-0}'), schema)).toBeNull();
  });

  it("嵌套必填、额外字段和保留键仍受校验", () => {
    const schema = {
      type: "object",
      required: ["profile"],
      properties: {
        profile: {
          type: "object",
          required: ["name"],
          properties: { name: { type: "string", minLength: 1 } },
          additionalProperties: false,
        },
      },
    };
    expect(validateJsonObjectSchema({ profile: {} }, schema)).toContain("name");
    expect(validateJsonObjectSchema({ profile: { name: "客户", extra: true } }, schema)).toContain("extra");
    expect(validateJsonObjectSchema(JSON.parse('{"profile":{"name":"客户","__proto__":{}}}'), schema)).toContain("__proto__");
  });
});
