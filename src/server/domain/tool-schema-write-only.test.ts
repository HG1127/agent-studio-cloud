import { describe, expect, it, vi } from "vitest";
import { isToolSchemaSafeToExpose } from "./tool-schema-visibility";
import { validateJsonSchemaDefinition } from "./json-schema";
import { parseToolRegistry } from "@/server/tools/tool-registry";
import * as redaction from "./security/redact-sensitive";
import { writeOnlySchemaLiteralsAreSafe } from "./tool-schema-write-only";

const literals = ["default", "const", "enum", "examples"] as const;
function literal(keyword: string, value: unknown) { return { [keyword]: ["enum", "examples"].includes(keyword) ? [value] : value }; }
function field(rule: Record<string, unknown>) { return { type: "object", properties: { value: rule } }; }

describe("仅写字段的公开固定文字边界", () => {
  it.each(literals)("%s 中的仅写文字不因中性字段名称而泄露", (keyword) => {
    const schema = field({ type: "string", writeOnly: true, ...literal(keyword, "opaque-fixture-value") });
    const before = JSON.stringify(schema);
    expect(validateJsonSchemaDefinition(schema)).toBeNull();
    expect(isToolSchemaSafeToExpose(schema)).toBe(false);
    expect(JSON.stringify(schema)).toBe(before);
    expect(isToolSchemaSafeToExpose(field({ type: "string", writeOnly: false, ...literal(keyword, "business-value") }))).toBe(true);
  });

  it.each(literals)("父级 %s 的对象值也按子字段说明检查，但不隐藏无关业务值", (keyword) => {
    const schema = { type: "object", properties: { value: { type: "string", writeOnly: true }, label: { type: "string" } } };
    expect(isToolSchemaSafeToExpose({ ...schema, ...literal(keyword, { value: "opaque-fixture-value", label: "业务" }) })).toBe(false);
    expect(isToolSchemaSafeToExpose({ ...schema, ...literal(keyword, { value: "", label: "业务" }) })).toBe(true);
    expect(isToolSchemaSafeToExpose({ ...schema, ...literal(keyword, { label: "业务" }) })).toBe(true);
  });

  it.each(["allOf", "anyOf", "oneOf"])("%s 分支间的同值及嵌套说明不能被分开扫描绕过", (keyword) => {
    for (const reverse of [false, true]) {
      const branches = [{ writeOnly: true }, { const: "opaque-fixture-value" }];
      if (reverse) branches.reverse();
      expect(isToolSchemaSafeToExpose(field({ [keyword]: branches }))).toBe(false);
      const nested = [{ properties: { value: { writeOnly: true } } }, { default: { value: "opaque-fixture-value" } }];
      if (reverse) nested.reverse();
      expect(isToolSchemaSafeToExpose({ type: "object", [keyword]: nested })).toBe(false);
      const child = [{ properties: { value: { writeOnly: true } } }, { properties: { value: { default: "opaque-fixture-value" } } }];
      expect(isToolSchemaSafeToExpose({ type: "object", [keyword]: child })).toBe(false);
    }
  });

  it.each(["items", "additionalProperties"])("%s 保护嵌套固定文字及父级示例，不把整个父对象都当凭据", (keyword) => {
    const rule = { [keyword]: { type: "string", writeOnly: true } };
    const value = keyword === "items" ? ["opaque-fixture-value"] : { arbitrary: "opaque-fixture-value" };
    expect(isToolSchemaSafeToExpose(field({ ...rule, default: value }))).toBe(false);
    expect(isToolSchemaSafeToExpose({ ...field(rule), examples: [{ value }] })).toBe(false);
    expect(isToolSchemaSafeToExpose({ ...field(rule), examples: [{ label: "业务" }] })).toBe(true);
  });

  it("一个组合分支的任意属性说明仍适用于另一分支的命名字段", () => {
    expect(isToolSchemaSafeToExpose({ type: "object", allOf: [{ additionalProperties: { writeOnly: true } }, { properties: { value: { default: "opaque-fixture-value" } } }] })).toBe(false);
    expect(isToolSchemaSafeToExpose({ type: "object", properties: { label: { default: "业务" } }, additionalProperties: { writeOnly: true } })).toBe(true);
  });

  it.each([false, true])("共享引用目标及父级固定值在 %s 顺序均继承敏感范围，false 不能洗白", (reverse) => {
    const fields = [["ordinary", { $ref: "#/$defs/Text" }], ["value", { $ref: "#/$defs/Text", writeOnly: true }]];
    if (reverse) fields.reverse();
    expect(isToolSchemaSafeToExpose({ type: "object", properties: Object.fromEntries(fields), $defs: { Text: { type: "string", default: "opaque-fixture-value", writeOnly: false } } })).toBe(false);
    const schema = { type: "object", properties: { value: { $ref: "#/$defs/Object" } }, $defs: { Object: { properties: { nested: { $ref: "#/$defs/Text" } } }, Text: { type: "string", writeOnly: true } }, default: { value: { nested: "opaque-fixture-value" } } };
    expect(isToolSchemaSafeToExpose(schema)).toBe(false);
  });

  it("否定分支的说明不向父级传播，但其自身固定文字仍受保护", () => {
    expect(isToolSchemaSafeToExpose({ type: "object", not: { writeOnly: true, const: "opaque-fixture-value" } })).toBe(false);
    expect(isToolSchemaSafeToExpose({ type: "object", not: { writeOnly: true }, default: { label: "业务" } })).toBe(true);
  });

  it("未用定义仍扫描，普通字段及原凭据字段边界不变", () => {
    expect(isToolSchemaSafeToExpose({ type: "object", $defs: { Unused: { writeOnly: true, examples: ["opaque-fixture-value"] } } })).toBe(false);
    expect(isToolSchemaSafeToExpose({ type: "object", properties: { apiKey: { writeOnly: false, default: "opaque-fixture-value" } } })).toBe(false);
    expect(isToolSchemaSafeToExpose({ type: "object", readOnly: true, deprecated: true, default: { label: "业务" } })).toBe(true);
    expect(isToolSchemaSafeToExpose(field({ type: "string", writeOnly: true, default: "", examples: [""] }))).toBe(true);
    expect(isToolSchemaSafeToExpose(field({ writeOnly: true, default: { amount: 0, active: false, absent: null } }))).toBe(true);
  });

  it("相同定义在不同组合范围不能借用宽松的嵌套扫描结论", () => {
    const shared = { properties: { nested: { type: "string", default: "opaque-fixture-value" } } };
    const schema = { type: "object", properties: { ordinary: shared, protected: { allOf: [shared, { properties: { nested: { writeOnly: true } } }] } } };
    expect(isToolSchemaSafeToExpose(schema)).toBe(false);
  });

  it("实际注册公开保留安全说明，含仅写固定文字的定义不能登记", () => {
    const inputSchema = { type: "object", properties: { value: { type: "string", writeOnly: true }, receipt: { type: "string", readOnly: true, deprecated: false } } };
    const registration = { id: "lookup", name: "查询记录", action: "lookup", scope: "record.read", protocol: "mcp-streamable-http", operationKind: "read", endpoint: "https://fixture.example/mcp", inputSchema };
    expect(parseToolRegistry(JSON.stringify([registration]))[0]?.inputSchema).toEqual(inputSchema);
    expect(parseToolRegistry(JSON.stringify([{ ...registration, inputSchema: { ...inputSchema, default: { value: "opaque-fixture-value" } } }]))).toEqual([]);
  });

  it("无仅写说明不增加既有大型共享默认值的重复脱敏扫描", () => {
    const redact = vi.spyOn(redaction, "redactCredentialText");
    try {
      const schema = { type: "object", properties: Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`field${index}`, { $ref: "#/$defs/Options", readOnly: true }])),
        $defs: { Options: { default: Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [`option${index}`, "business-value"])) } } };
      expect(isToolSchemaSafeToExpose(schema)).toBe(true);
      expect(redact.mock.calls.length).toBeLessThan(5_000);
    } finally { redact.mockRestore(); }
  });

  it("复杂组合的字面扫描缓存有总量预算，超限关闭公开但不缩小既有无仅写定义", () => {
    const Large = { type: "object", properties: { rows: { type: "array", items: { type: "number" } } }, default: { rows: Array.from({ length: 1000 }, (_, index) => index) } };
    const schema = { type: "object", properties: Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`field${index}`, {
      $ref: "#/$defs/Large", properties: { rows: { items: {} } },
    }])), $defs: { Large, Unused: { writeOnly: true } } };
    expect(validateJsonSchemaDefinition(schema)).toBeNull();
    expect(writeOnlySchemaLiteralsAreSafe(schema)).toBe(false);
    expect(isToolSchemaSafeToExpose(schema)).toBe(false);
    expect(isToolSchemaSafeToExpose({ ...schema, $defs: { Large } })).toBe(true);
  });
});
