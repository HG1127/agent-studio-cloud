import { describe, expect, it, vi } from "vitest";
import { validateJsonObjectSchema, validateJsonSchemaDefinition } from "./json-schema";
import { MAX_LOCAL_SCHEMA_REFERENCE_HOPS } from "./json-schema-reference";
import { isToolSchemaSafeToExpose } from "./tool-schema-visibility";
import { mcpToolDefinitionIssue, mcpToolInputDefinitionIssue, mcpToolOutputDefinitionIssue, normalizeMcpToolResult } from "./runtime/mcp-tool";

function field(rule: Record<string, unknown>) {
  return { type: "object", required: ["value"], properties: { value: rule }, additionalProperties: false };
}

describe("共享字段契约格式说明", () => {
  it.each(["uri", "uri-reference", "date-time", "date", "time", "email", "uuid", "hostname", "ipv4", "ipv6", "regex", "vendor-format", "", "  custom  "])("原样保留 %j，仅作说明，不冒充语义校验", (format) => {
    const schema = field({ type: "string", format }), payload = { value: "不是网址、邮箱或日期" };
    const before = JSON.stringify([schema, payload]);
    expect(validateJsonSchemaDefinition(schema)).toBeNull();
    expect(validateJsonObjectSchema(payload, schema)).toBeNull();
    expect(isToolSchemaSafeToExpose(schema)).toBe(true);
    expect(mcpToolInputDefinitionIssue(schema)).toBeNull();
    expect(mcpToolOutputDefinitionIssue(schema, schema)).toBeNull();
    expect(normalizeMcpToolResult({ structuredContent: payload }, schema)).toEqual({ ok: true, output: payload });
    expect(JSON.stringify([schema, payload])).toBe(before);
  });

  it.each([
    "http://json-schema.org/draft-04/schema#", "https://json-schema.org/draft-06/schema",
    "http://json-schema.org/draft-07/schema#", "https://json-schema.org/draft-07/schema",
    "https://json-schema.org/draft/2019-09/schema", "http://json-schema.org/draft/2020-12/schema#",
  ])("已知方言 %s 保持格式断言关闭，其他结构约束仍生效", ($schema) => {
    const schema = { ...field({ type: "string", format: "date-time" }), $schema };
    expect(validateJsonSchemaDefinition(schema)).toBeNull();
    expect(validateJsonObjectSchema({ value: "not-a-date" }, schema)).toBeNull();
    expect(validateJsonObjectSchema({ value: 0 }, schema)).toContain("类型不正确");
  });

  it("格式说明不隐含字符串类型，也不覆盖必填、枚举、长度或安全正则", () => {
    expect(validateJsonObjectSchema({ value: 0 }, field({ format: "email" }))).toBeNull();
    expect(validateJsonObjectSchema({}, { type: "object", format: "uri" })).toBeNull();
    const schema = field({ type: "string", format: "uri", minLength: 2, maxLength: 8, pattern: "^[A-Z]+$", enum: ["AB", "ABC"] });
    expect(validateJsonObjectSchema({ value: "AB" }, schema)).toBeNull();
    for (const payload of [{}, { value: 0 }, { value: "A" }, { value: "ab" }, { value: "ABCDE" }, { value: "A".repeat(9) }, { value: "AB", extra: false }]) {
      expect(validateJsonObjectSchema(payload, schema)).not.toBeNull();
    }
    expect(validateJsonObjectSchema({ value: "ab" }, field({ format: "uri", pattern: "^[A-Z]+$", maxLength: 8 }))).toContain("格式不符合");
    expect(validateJsonObjectSchema({ value: "A" }, field({ format: "uri", minLength: 2 }))).toContain("不能少于");
    expect(validateJsonObjectSchema({ value: "ABC" }, field({ format: "uri", maxLength: 2 }))).toContain("不能超过");
    expect(validateJsonSchemaDefinition(field({ format: "email", pattern: "(a+)+", maxLength: 8 }))).not.toBeNull();
  });

  it("组合中的格式说明不被误当断言，否定和排他分支保留真实语义", () => {
    expect(validateJsonObjectSchema({}, { allOf: [{ format: "uri" }, { format: "date-time" }] })).toBeNull();
    expect(validateJsonObjectSchema({}, { anyOf: [{ format: "uri" }, false] })).toBeNull();
    expect(validateJsonObjectSchema({}, { not: { format: "uri" } })).toContain("不能符合排除规则");
    expect(validateJsonObjectSchema({}, { oneOf: [{ format: "uri" }, { format: "date-time" }] })).toContain("只能符合一项");
    expect(validateJsonObjectSchema({ values: ["not-a-date"], other: "not-a-url" }, {
      type: "object", properties: { values: { type: "array", items: { type: "string", format: "date-time" } } },
      additionalProperties: { type: "string", format: "uri" },
    })).toBeNull();
  });

  it.each([undefined, null, false, 17, [], {}].map((format) => ({ format })))("非字符串格式说明在可选分支和未用定义里也拒绝 %#", ({ format }) => {
    for (const schema of [field({ format }), { anyOf: [{}, { format }] }, { $defs: { Unused: { format } } }]) {
      expect(validateJsonSchemaDefinition(schema)).toContain("format 必须是文字");
      expect(validateJsonObjectSchema({}, schema)).toContain("format 必须是文字");
    }
  });

  it("格式访问器不被执行，报错不包含原始说明", () => {
    const getter = vi.fn(() => "private-format-value"), rule = { get format() { return getter(); } };
    expect(validateJsonSchemaDefinition(field(rule))).toContain("format 必须是文字");
    expect(validateJsonObjectSchema({}, field(rule))).toContain("format 必须是文字");
    expect(isToolSchemaSafeToExpose(field(rule))).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });

  it.each(["https://private.example/format-assertions", "https://json-schema.org/draft/2020-12/meta/format-assertion", "http://json-schema.org/draft-03/schema#"])("未知方言 %s 不静默降级格式语义，也不联网获取规则", ($schema) => {
    for (const schema of [{ ...field({ format: "email" }), $schema }, { ...field({ format: "email" }), $defs: { Unused: { $schema } } }]) {
      expect(validateJsonSchemaDefinition(schema)).toContain("格式说明不支持未知");
      expect(validateJsonObjectSchema({ value: "bad" }, schema)).toContain("格式说明不支持未知");
      expect(isToolSchemaSafeToExpose(schema)).toBe(false);
    }
  });

  it("显式格式断言词汇表不能冒充仅注解支持", () => {
    const schema = { ...field({ format: "email" }), $vocabulary: { "https://json-schema.org/draft/2020-12/vocab/format-assertion": true } };
    expect(validateJsonSchemaDefinition(schema)).toContain("暂不支持的规则“$vocabulary”");
    expect(validateJsonObjectSchema({ value: "bad" }, schema)).not.toBeNull();
  });

  it("本地引用上的格式说明保持元数据语义，32 层别名仍接受完整一兆字节回执", () => {
    const $defs = Object.fromEntries(Array.from({ length: MAX_LOCAL_SCHEMA_REFERENCE_HOPS }, (_, index) => [`Alias${index}`,
      index === MAX_LOCAL_SCHEMA_REFERENCE_HOPS - 1 ? { type: "string", format: "vendor-text" } : { $ref: `#/$defs/Alias${index + 1}`, format: "uri" }]));
    const schema = { ...field({ $ref: "#/$defs/Alias0", format: "date-time" }), $defs };
    const value = "x".repeat(1024 * 1024 - new TextEncoder().encode(JSON.stringify({ value: "" })).byteLength);
    expect(validateJsonSchemaDefinition(schema)).toBeNull();
    expect(validateJsonObjectSchema({ value }, schema)).toBeNull();
    expect(normalizeMcpToolResult({ structuredContent: { value: "not-a-date" } }, schema)).toEqual({ ok: true, output: { value: "not-a-date" } });
    expect(validateJsonSchemaDefinition({ ...schema, $schema: "http://json-schema.org/draft-07/schema#" })).toContain("暂不支持的规则“$ref”");
  });

  it("格式文字计入既有定义工作预算，不扩容或泄露说明", () => {
    const schema = field({ format: "x".repeat(8 * 1024 * 1024) });
    expect(validateJsonSchemaDefinition(schema)).toContain("校验工作量超过 8388608 单位");
    expect(validateJsonObjectSchema({}, schema)).toContain("校验工作量超过 8388608 单位");
  });

  it.each(["uri", "date-time"])("格式说明 %s 变化仍被完整远端定义比较拒绝", (format) => {
    const schema = field({ type: "string", format });
    const changed = field({ type: "string", format: "vendor-format" });
    expect(mcpToolDefinitionIssue(schema, schema)).toBeNull();
    expect(mcpToolDefinitionIssue(changed, schema)).not.toBeNull();
    expect(mcpToolOutputDefinitionIssue(changed, schema)).not.toBeNull();
  });

  it("新支持的格式文字继续经过公开凭据扫描，不因说明性质泄露令牌", () => {
    const schema = field({ type: "string", format: "Bearer fixture-secret-value" });
    expect(validateJsonSchemaDefinition(schema)).toBeNull();
    expect(isToolSchemaSafeToExpose(schema)).toBe(false);
    expect(isToolSchemaSafeToExpose(field({ type: "string", format: "vendor-format" }))).toBe(true);
  });
});
