import { describe, expect, it } from "vitest";
import { validateJsonObjectSchema, validateJsonSchemaDefinition } from "@/server/domain/json-schema";

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
