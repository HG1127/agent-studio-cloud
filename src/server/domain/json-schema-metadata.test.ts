import { describe, expect, it, vi } from "vitest";
import { validateJsonObjectSchema, validateJsonSchemaDefinition } from "./json-schema";
import { MAX_LOCAL_SCHEMA_REFERENCE_HOPS } from "./json-schema-reference";
import { mcpToolDefinitionIssue, mcpToolInputDefinitionIssue, mcpToolOutputDefinitionIssue, normalizeMcpToolResult } from "./runtime/mcp-tool";

const annotations = ["readOnly", "writeOnly", "deprecated"] as const;
function field(rule: Record<string, unknown>) {
  return { type: "object", required: ["value"], properties: { value: rule }, additionalProperties: false };
}

describe("共享字段布尔说明", () => {
  it.each(annotations.flatMap((keyword) => [true, false].map((value) => ({ keyword, value }))))("%s 原样保留，不当作类型、权限或字段改写指令", ({ keyword, value }) => {
    const schema = field({ type: "string", [keyword]: value }), payload = { value: "业务文字" };
    const before = JSON.stringify([schema, payload]);
    expect(validateJsonSchemaDefinition(schema)).toBeNull();
    expect(validateJsonObjectSchema(payload, schema)).toBeNull();
    expect(mcpToolInputDefinitionIssue(schema)).toBeNull();
    expect(mcpToolOutputDefinitionIssue(schema, schema)).toBeNull();
    expect(normalizeMcpToolResult({ structuredContent: payload }, schema)).toEqual({ ok: true, output: payload });
    expect(validateJsonObjectSchema({}, schema)).toContain("必填");
    expect(validateJsonObjectSchema({ value: 0 }, schema)).toContain("类型不正确");
    expect(JSON.stringify([schema, payload])).toBe(before);
  });

  it.each(annotations.flatMap((keyword) => [undefined, null, 0, "true", [], {}].map((value) => ({ keyword, value }))))("损坏说明在可选分支与未用定义也拒绝 %#", ({ keyword, value }) => {
    for (const schema of [field({ [keyword]: value }), { anyOf: [{}, { [keyword]: value }] }, { $defs: { Unused: { [keyword]: value } } }]) {
      expect(validateJsonSchemaDefinition(schema)).toContain("字段说明必须是布尔值");
      expect(validateJsonObjectSchema({}, schema)).toContain("字段说明必须是布尔值");
    }
  });

  it.each(annotations)("%s 访问器不被执行，错误不包含返回值", (keyword) => {
    const getter = vi.fn(() => "private-annotation-value");
    const schema = field(Object.defineProperty({}, keyword, { enumerable: true, get: getter }));
    expect(validateJsonSchemaDefinition(schema)).toContain("字段说明必须是布尔值");
    expect(validateJsonObjectSchema({}, schema)).toContain("字段说明必须是布尔值");
    expect(getter).not.toHaveBeenCalled();
  });

  it.each(annotations)("%s 不改变组合、否定或排他规则的真实结果", (keyword) => {
    expect(validateJsonObjectSchema({}, { [keyword]: true })).toBeNull();
    expect(validateJsonObjectSchema({}, { allOf: [{ [keyword]: true }, {}] })).toBeNull();
    expect(validateJsonObjectSchema({}, { not: { [keyword]: true } })).toContain("不能符合排除规则");
    expect(validateJsonObjectSchema({}, { oneOf: [{ [keyword]: true }, { [keyword]: false }] })).toContain("只能符合一项");
  });

  it.each(annotations)("%s 不猜测未知或混合自定义方言的含义", (keyword) => {
    for (const schema of [{ ...field({ [keyword]: true }), $schema: "https://private.example/annotations" },
      { ...field({ [keyword]: false }), $defs: { Unused: { $schema: "https://private.example/annotations" } } }]) {
      expect(validateJsonSchemaDefinition(schema)).toContain("字段说明不支持未知");
      expect(validateJsonObjectSchema({}, schema)).toContain("字段说明不支持未知");
    }
    expect(validateJsonSchemaDefinition({ ...field({ [keyword]: true }), $vocabulary: {} })).toContain("暂不支持的规则“$vocabulary”");
  });

  it.each(["http://json-schema.org/draft-07/schema#", "https://json-schema.org/draft/2019-09/schema", "https://json-schema.org/draft/2020-12/schema"])("已知方言 %s 原样保留布尔说明，不扩大旧引用支持", ($schema) => {
    expect(validateJsonObjectSchema({ value: 0 }, { ...field({ type: "number", readOnly: true, writeOnly: false, deprecated: true }), $schema })).toBeNull();
  });

  it("32 层纯引用包装上的三类说明不重复扫描完整一兆字节值", () => {
    const $defs = Object.fromEntries(Array.from({ length: MAX_LOCAL_SCHEMA_REFERENCE_HOPS }, (_, index) => [`Alias${index}`,
      index === MAX_LOCAL_SCHEMA_REFERENCE_HOPS - 1 ? { type: "string", readOnly: true } : { $ref: `#/$defs/Alias${index + 1}`, writeOnly: false, deprecated: true }]));
    const schema = { ...field({ $ref: "#/$defs/Alias0", readOnly: true, writeOnly: true, deprecated: false }), $defs };
    const value = "x".repeat(1024 * 1024 - new TextEncoder().encode(JSON.stringify({ value: "" })).byteLength);
    expect(validateJsonSchemaDefinition(schema)).toBeNull();
    expect(validateJsonObjectSchema({ value }, schema)).toBeNull();
    expect(validateJsonSchemaDefinition({ ...schema, $schema: "http://json-schema.org/draft-07/schema#" })).not.toBeNull();
  });

  it.each(annotations)("%s 变化仍被完整输入、回执定义比较拒绝，不删除后比较", (keyword) => {
    const schema = field({ type: "string", [keyword]: true }), changed = field({ type: "string", [keyword]: false });
    expect(mcpToolDefinitionIssue(schema, schema)).toBeNull();
    expect(mcpToolDefinitionIssue(changed, schema)).not.toBeNull();
    expect(mcpToolOutputDefinitionIssue(changed, schema)).not.toBeNull();
  });
});
