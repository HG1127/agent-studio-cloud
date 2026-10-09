import { describe, expect, it, vi } from "vitest";
import { isToolSchemaSafeToExpose } from "./tool-schema-visibility";

describe("工具字段定义的公开凭据边界", () => {
  it.each(["default", "const", "enum", "examples"])("识别 %s 内嵌套的凭据，不修改定义", (keyword) => {
    const secret = { nested: [{ authorization: "private-fake-value" }] };
    const schema = { type: "object", [keyword]: ["enum", "examples"].includes(keyword) ? [secret] : secret };
    const original = JSON.stringify(schema);
    expect(isToolSchemaSafeToExpose(schema)).toBe(false);
    expect(JSON.stringify(schema)).toBe(original);
  });
  it("识别超过旧上下文脱敏深度的固定值", () => {
    let value: unknown = { apiKey: "private-deep-value" };
    for (let index = 0; index < 20; index++) value = { child: value };
    expect(isToolSchemaSafeToExpose({ type: "object", default: value })).toBe(false);
  });
  it("只含类型的凭据字段声明不会被误删，空值和业务否定值不变", () => {
    const schema = { type: "object", properties: { apiKey: { type: "string", examples: [""] }, cookie: { type: ["null", "string"], default: null }, inputTokens: { type: "integer", const: 0 }, approved: { type: "boolean", const: false }, email: { type: "string", default: "person@example.com" } }, required: ["apiKey"] };
    const original = JSON.stringify(schema);
    expect(isToolSchemaSafeToExpose(schema)).toBe(true);
    expect(JSON.stringify(schema)).toBe(original);
  });
  it("数组项继承凭据字段性质，但普通文字字段不变", () => {
    expect(isToolSchemaSafeToExpose({ type: "object", properties: { apiKeys: { type: "array", items: { type: "string", enum: ["private-fake-value"] } } } })).toBe(false);
    expect(isToolSchemaSafeToExpose({ type: "object", properties: { codes: { type: "array", items: { type: "string", enum: ["business-code"] } } } })).toBe(true);
  });
  it("凭据对象的子字段和任意属性规则继承固定值检查", () => {
    expect(isToolSchemaSafeToExpose({ type: "object", properties: { credential: { type: "object", properties: { value: { type: "string", const: "private-fake-value" } } } } })).toBe(false);
    expect(isToolSchemaSafeToExpose({ type: "object", properties: { credential: { type: "object", additionalProperties: { type: "string", default: "private-fake-value" } } } })).toBe(false);
    expect(isToolSchemaSafeToExpose({ type: "object", properties: { credential: { type: "object", properties: { value: { type: "string" } } } } })).toBe(true);
  });
  it("分词名称、模式和用量单位是普通参数，字段与嵌套示例均原样保留", () => {
    const schema = { type: "object", properties: { tokenizer: { type: "string", enum: ["algorithm-a"] }, tokenizationMode: { type: "string", default: "words" }, tokenUnit: { type: "string", const: "characters" }, modelTokenizerName: { type: "string", default: "algorithm-b" } }, default: { tokenizer: "algorithm-a", tokenizationMode: "words", tokenUnit: "characters" }, examples: [{ options: { tokenizer: "algorithm-b", tokenizationMode: "characters", tokenUnit: "words" } }] };
    const original = JSON.stringify(schema);
    expect(isToolSchemaSafeToExpose(schema)).toBe(true);
    expect(JSON.stringify(schema)).toBe(original);
  });
  it.each(["token", "tokenizerApiKey", "tokenizationSecret", "tokenUnitCredential"])("普通分词词缀不放行实际凭据字段 %s", (field) => {
    expect(isToolSchemaSafeToExpose({ type: "object", properties: { [field]: { type: "string", const: "private-fake-value" } } })).toBe(false);
    expect(isToolSchemaSafeToExpose({ type: "object", examples: [{ [field]: "private-fake-value" }] })).toBe(false);
  });
  it("拒绝非被动数据而不执行访问器或序列化代码", () => {
    const read = vi.fn();
    const schema = Object.defineProperty({ type: "object" }, "description", { enumerable: true, get: read });
    expect(isToolSchemaSafeToExpose(schema)).toBe(false);
    expect(read).not.toHaveBeenCalled();
    expect(isToolSchemaSafeToExpose({ type: "object", default: { toJSON: read } })).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });
  it("无法检查的过深数据、循环和非法定义关闭公开", () => {
    let value: unknown = null;
    for (let index = 0; index < 33; index++) value = { child: value };
    expect(isToolSchemaSafeToExpose({ type: "object", default: value })).toBe(false);
    const cycle: Record<string, unknown> = { type: "object" }; cycle.default = cycle;
    expect(isToolSchemaSafeToExpose(cycle)).toBe(false);
    expect(isToolSchemaSafeToExpose({ type: "object", properties: { amount: { type: "number", minimum: 2, maximum: 1 } } })).toBe(false);
  });
});
