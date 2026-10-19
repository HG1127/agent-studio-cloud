import { describe, expect, it, vi } from "vitest";
import { isToolSchemaSafeToExpose } from "./tool-schema-visibility";
import { parseToolRegistry } from "@/server/tools/tool-registry";
import * as redaction from "@/server/domain/security/redact-sensitive";

describe("复用字段定义的公开凭据边界", () => {
  it.each(["$defs", "definitions"])("%s 是字段声明而非业务字面值，普通固定业务值及凭据类型仍可公开", (keyword) => {
    const schema = { type: "object", properties: { apiKey: { $ref: `#/${keyword}/Text` }, code: { $ref: `#/${keyword}/Code` } }, [keyword]: { Text: { type: "string" }, Code: { const: "business-code" } } };
    const before = JSON.stringify(schema);
    expect(isToolSchemaSafeToExpose(schema)).toBe(true);
    expect(JSON.stringify(schema)).toBe(before);
  });
  it.each(["default", "const", "enum", "examples"])("凭据引用的 %s 字面值不因中性定义名而泄露", (keyword) => {
    const schema = { type: "object", properties: { apiKey: { $ref: "#/$defs/Value" } }, $defs: { Value: { type: "string", [keyword]: ["enum", "examples"].includes(keyword) ? ["private-fake-value"] : "private-fake-value" } } };
    expect(isToolSchemaSafeToExpose(schema)).toBe(false);
  });
  it.each([false, true])("同一目标同时被普通字段和凭据字段引用时，%s 顺序不能复用宽松结论", (reverse) => {
    const fields = [["apiKey", { $ref: "#/$defs/Value" }], ["code", { $ref: "#/$defs/Value" }]];
    if (reverse) fields.reverse();
    expect(isToolSchemaSafeToExpose({ type: "object", properties: Object.fromEntries(fields), $defs: { Value: { const: "private-fake-value" } } })).toBe(false);
  });
  it.each(["items", "additionalProperties", "not"])("%s 内的引用继续继承凭据性质", (keyword) => {
    expect(isToolSchemaSafeToExpose({ type: "object", properties: { apiKey: { [keyword]: { $ref: "#/$defs/Value" } } }, $defs: { Value: { const: "private-fake-value" } } })).toBe(false);
  });
  it.each(["allOf", "anyOf", "oneOf"])("%s 下的引用不能藏匿凭据固定值", (keyword) => {
    expect(isToolSchemaSafeToExpose({ type: "object", properties: { apiKey: { [keyword]: [{ $ref: "#/$defs/Value" }] } }, $defs: { Value: { const: "private-fake-value" } } })).toBe(false);
  });
  it("引用对象里的嵌套凭据、未引用的定义及敏感定义名称也须检查", () => {
    expect(isToolSchemaSafeToExpose({ type: "object", $defs: { Unused: { properties: { password: { default: "private-fake-value" } } } } })).toBe(false);
    expect(isToolSchemaSafeToExpose({ type: "object", $defs: { apiKey: { const: "private-fake-value" } } })).toBe(false);
    expect(isToolSchemaSafeToExpose({ type: "object", properties: { profile: { $ref: "#/$defs/Profile" } }, $defs: { Profile: { properties: { password: { default: "private-fake-value" } } } } })).toBe(false);
  });
  it("空凭据值、零值及业务否定值不因引用而改写", () => {
    expect(isToolSchemaSafeToExpose({ type: "object", properties: { apiKey: { $ref: "#/$defs/Empty" }, amount: { $ref: "#/$defs/Zero" }, active: { $ref: "#/$defs/False" } }, $defs: { Empty: { type: "string", const: "" }, Zero: { const: 0 }, False: { const: false } } })).toBe(true);
  });
  it("引用共享定义不会重复扫描其大型默认对象", () => {
    const redact = vi.spyOn(redaction, "redactCredentialText");
    try {
      const properties = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`field${index}`, { $ref: "#/$defs/Options" }]));
      const defaults = Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [`option${index}`, "business-code"]));
      expect(isToolSchemaSafeToExpose({ type: "object", properties, $defs: { Options: { default: defaults } } })).toBe(true);
      expect(redact).toHaveBeenCalledWith("option999");
      expect(redact.mock.calls.length).toBeLessThan(5_000);
    } finally { redact.mockRestore(); }
  });
  it("注册表公开与运行继续使用同一份原始定义，不展开或丢弃未用定义", () => {
    const inputSchema = { type: "object", properties: { code: { $ref: "#/$defs/Code" } }, $defs: { Code: { type: "string" }, Unused: false } };
    const registration = { id: "lookup", name: "查询资料", action: "lookup", scope: "business.read", protocol: "mcp-streamable-http", operationKind: "read", endpoint: "https://fixture.example/mcp", inputSchema };
    const parsed = parseToolRegistry(JSON.stringify([registration]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].inputSchema).toEqual(inputSchema);
    expect(parseToolRegistry(JSON.stringify([{ ...registration, inputSchema: { ...inputSchema, properties: { apiKey: { $ref: "#/$defs/Code" } }, $defs: { Code: { const: "private-fake-value" } } } }]))).toEqual([]);
  });
});
