import { describe, expect, it } from "vitest";
import { validateJsonObjectSchema, validateJsonSchemaDefinition } from "./json-schema";

function fieldSchema(rule: unknown) {
  return { type: "object", required: ["value"], properties: { value: rule } };
}

describe("组合字段契约", () => {
  const nullable = { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] };
  it.each([null, "客户"])("可空字段接受合法值 %j", (value) => {
    expect(validateJsonSchemaDefinition(fieldSchema(nullable))).toBeNull();
    expect(validateJsonObjectSchema({ value }, fieldSchema(nullable))).toBeNull();
  });
  it.each(["", 0, false, {}])("可选规则不接收不匹配值 %j", (value) => {
    expect(validateJsonObjectSchema({ value }, fieldSchema(nullable))).toContain("不符合任一");
  });
  it("anyOf 允许同时匹配多个分支，但仍执行同级规则", () => {
    const schema = fieldSchema({ type: "number", minimum: 1, anyOf: [{ type: "integer" }, { type: "number" }] });
    expect(validateJsonObjectSchema({ value: 2 }, schema)).toBeNull();
    expect(validateJsonObjectSchema({ value: 0 }, schema)).toContain("不能小于 1");
  });
  it("allOf 同时执行每项约束，不改变业务值", () => {
    const schema = fieldSchema({ allOf: [{ type: "number", minimum: 0 }, { maximum: 100 }, { not: { const: 42 } }] });
    expect(validateJsonObjectSchema({ value: 0 }, schema)).toBeNull();
    expect(validateJsonObjectSchema({ value: -1 }, schema)).toContain("不能小于");
    expect(validateJsonObjectSchema({ value: 101 }, schema)).toContain("不能大于");
    expect(validateJsonObjectSchema({ value: 42 }, schema)).toContain("排除规则");
  });
  it("allOf 不把独立的封闭对象规则合并为宽松对象", () => {
    const schema = { allOf: [
      { type: "object", properties: { id: { type: "string" } }, additionalProperties: false },
      { type: "object", properties: { name: { type: "string" } } },
    ] };
    expect(validateJsonObjectSchema({ id: "c1" }, schema)).toBeNull();
    expect(validateJsonObjectSchema({ id: "c1", name: "客户" }, schema)).toContain("name不是允许的字段");
  });
  it.each([
    { value: 5, accepted: false },
    { value: -2, accepted: true },
    { value: 0.5, accepted: true },
    { value: "客户", accepted: false },
  ])("oneOf 必须精确匹配一项：$value", ({ value, accepted }) => {
    const schema = fieldSchema({ oneOf: [{ type: "integer" }, { type: "number", minimum: 0 }] });
    expect(validateJsonObjectSchema({ value }, schema) === null).toBe(accepted);
  });
  it.each(["blocked", "ready"])("not 排除匹配的值：%s", (value) => {
    expect(validateJsonObjectSchema({ value }, fieldSchema({ not: { const: "blocked" } })) === null).toBe(value !== "blocked");
  });
  it("多个组合关键字和普通字段规则共同生效", () => {
    const schema = fieldSchema({ type: "integer", allOf: [{ minimum: 0 }], anyOf: [{ maximum: 3 }, { minimum: 8 }], oneOf: [{ maximum: 10 }, { minimum: 20 }], not: { const: 2 } });
    expect(validateJsonObjectSchema({ value: 1 }, schema)).toBeNull();
    for (const value of [-1, 2, 5, 15]) expect(validateJsonObjectSchema({ value }, schema)).not.toBeNull();
  });
  it("布尔子规则支持属性、数组项和任意属性，不静默忽略 false", () => {
    expect(validateJsonObjectSchema({ value: { anything: null } }, fieldSchema(true))).toBeNull();
    expect(validateJsonObjectSchema({ value: null }, fieldSchema(false))).toContain("不允许提供");
    const schema = fieldSchema({ type: "array", items: false });
    expect(validateJsonObjectSchema({ value: [] }, schema)).toBeNull();
    expect(validateJsonObjectSchema({ value: [0] }, schema)).toContain("不允许提供");
    expect(validateJsonObjectSchema({ value: { extra: false } }, fieldSchema({ additionalProperties: false }))).not.toBeNull();
  });
  it.each([
    { rule: { anyOf: [false, true] }, accepted: true },
    { rule: { anyOf: [false, false] }, accepted: false },
    { rule: { allOf: [true, true] }, accepted: true },
    { rule: { allOf: [true, false] }, accepted: false },
    { rule: { oneOf: [false, true] }, accepted: true },
    { rule: { oneOf: [true, true] }, accepted: false },
    { rule: { not: false }, accepted: true },
    { rule: { not: true }, accepted: false },
  ])("布尔组合语义不把真假当作缺少配置 %#", ({ rule, accepted }) => {
    expect(validateJsonSchemaDefinition(fieldSchema(rule))).toBeNull();
    expect(validateJsonObjectSchema({ value: false }, fieldSchema(rule)) === null).toBe(accepted);
  });
  it("校验不写入默认值、不修改分支顺序或业务数据", () => {
    const schema = fieldSchema({ anyOf: [{ type: "integer", default: 10 }, { type: "null" }] });
    const payload = { value: 0 };
    const before = JSON.stringify([schema, payload]);
    expect(validateJsonObjectSchema(payload, schema)).toBeNull();
    expect(JSON.stringify([schema, payload])).toBe(before);
  });
});

describe.each(["allOf", "anyOf", "oneOf"])("组合定义 %s 的关闭式校验", (keyword) => {
  it.each([null, {}, [], Array.from({ length: 101 }, () => ({}))])("拒绝空、格式错误或过多的分支 %#", (branches) => {
    expect(validateJsonSchemaDefinition({ [keyword]: branches })).toContain("必须包含 1 至 100 项");
  });
  it("定义先验证所有分支，不能由先匹配的空规则绕过非法分支", () => {
    for (const invalid of [null, [], "bad", { $ref: "unsupported" }, { pattern: "^x$" }]) {
      const schema = { [keyword]: [{}, invalid] };
      expect(validateJsonSchemaDefinition(schema)).not.toBeNull();
      expect(validateJsonObjectSchema({}, schema)).not.toBeNull();
    }
  });
});

describe("组合契约的运行边界", () => {
  it.each([null, [], "bad"])("not 也要求有效子规则 %j", (not) => {
    expect(validateJsonSchemaDefinition({ not })).not.toBeNull();
  });
  it("组合分支继承保留字段、正则和层级限制", () => {
    expect(validateJsonSchemaDefinition({ anyOf: [{}, { properties: { constructor: {} } }] })).toContain("保留字段");
    let schema: Record<string, unknown> = {};
    for (let depth = 0; depth < 9; depth++) schema = { not: schema };
    expect(validateJsonSchemaDefinition(schema)).toContain("超过 8 层");
  });
  it("全树规则预算包含所有分支，精确边界通过、超出拒绝", () => {
    const properties = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [
      `field_${index}`, { allOf: Array.from({ length: index === 0 ? 98 : 99 }, () => ({})) },
    ]));
    const schema = { type: "object", properties };
    expect(validateJsonSchemaDefinition(schema)).toBeNull();
    properties.field_0.allOf.push({});
    expect(validateJsonSchemaDefinition(schema)).toContain("不能超过 10000 项规则");
  });
  const costly = { type: "object", properties: { rows: { type: "array", items: { allOf: Array.from({ length: 100 }, () => ({ type: "string" })) } } } };
  it.each(["allOf", "anyOf", "oneOf", "not"])("共享工作预算超限不能被 %s 忽略或反转", (keyword) => {
    const schema = keyword === "not" ? { not: costly } : { [keyword]: keyword === "allOf" ? [costly] : [costly, {}] };
    const payload = { rows: Array.from({ length: 50 }, () => "x".repeat(9000)) };
    expect(validateJsonSchemaDefinition(schema)).toBeNull();
    expect(new TextEncoder().encode(JSON.stringify(payload)).byteLength).toBeLessThan(512 * 1024);
    expect(validateJsonObjectSchema(payload, schema)).toContain("校验工作量超过 8388608 单位");
  });
  it.each(["allOf", "anyOf", "oneOf", "not"])("重复扫描大对象的工作量不能被 %s 隐藏", (keyword) => {
    const scans = { allOf: Array.from({ length: 100 }, () => ({ allOf: Array.from({ length: 98 }, () => ({})) })) };
    const schema = keyword === "not" ? { not: scans } : { [keyword]: keyword === "allOf" ? [scans] : [scans, {}] };
    const payload = Object.fromEntries(Array.from({ length: 10_000 }, (_, index) => [`field_${index}`, 0]));
    expect(new TextEncoder().encode(JSON.stringify(schema)).byteLength).toBeLessThan(32 * 1024);
    expect(validateJsonSchemaDefinition(schema)).toBeNull();
    expect(validateJsonObjectSchema(payload, schema)).toContain("校验工作量超过 8388608 单位");
  });
  it.each(["enum", "const"])("%s 的实际深比较也计入共享预算", (keyword) => {
    const expected = { text: "x".repeat(50) };
    const rule = keyword === "enum" ? { enum: [expected] } : { const: expected };
    const schema = fieldSchema({ type: "array", items: { allOf: Array.from({ length: 100 }, () => rule) } });
    const payload = { value: Array.from({ length: 1000 }, () => ({ ...expected })) };
    expect(new TextEncoder().encode(JSON.stringify(schema)).byteLength).toBeLessThan(32 * 1024);
    expect(new TextEncoder().encode(JSON.stringify(payload)).byteLength).toBeLessThan(512 * 1024);
    expect(validateJsonSchemaDefinition(schema)).toBeNull();
    expect(validateJsonObjectSchema(payload, schema)).toContain("校验工作量超过 8388608 单位");
  });
  it("定义中的 enum 与 const 兼容性比较同样有界", () => {
    const text = "x".repeat(64_000);
    const schema = fieldSchema({ enum: Array.from({ length: 100 }, (_, index) => `${text}${index}`), const: `${text}99` });
    expect(validateJsonSchemaDefinition(schema)).toContain("校验工作量超过 8388608 单位");
  });
  it.each(["array", "object"])("嵌套 %s 比较的字段与元素遍历不能绕过预算", (kind) => {
    const expected = kind === "array" ? Array.from({ length: 100 }, () => "x".repeat(20))
      : Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`field_${index}`, 0]));
    const schema = fieldSchema({ type: "array", items: { allOf: Array.from({ length: 10 }, () => ({ const: expected })) } });
    const payload = { value: Array.from({ length: kind === "array" ? 210 : 400 }, () => JSON.parse(JSON.stringify(expected))) };
    expect(new TextEncoder().encode(JSON.stringify(schema)).byteLength).toBeLessThan(32 * 1024);
    expect(new TextEncoder().encode(JSON.stringify(payload)).byteLength).toBeLessThan(512 * 1024);
    expect(validateJsonSchemaDefinition(schema)).toBeNull();
    expect(validateJsonObjectSchema(payload, schema)).toContain("校验工作量超过 8388608 单位");
  });
  it.each([
    { value: "字".repeat(100_000), rule: { allOf: Array.from({ length: 100 }, () => ({ type: "string", minLength: 1 })) } },
    { value: "A".repeat(4000), rule: { allOf: Array.from({ length: 80 }, () => ({ type: "string", maxLength: 4096, pattern: "^[A-Z]+[A-Z]+[A-Z]+[A-Z]+$" })) } },
  ])("文字和有界正则扫描也计入共享工作量 %#", ({ value, rule }) => {
    const schema = fieldSchema(rule);
    expect(validateJsonSchemaDefinition(schema)).toBeNull();
    expect(validateJsonObjectSchema({ value }, schema)).toContain("校验工作量超过 8388608 单位");
  });
  it("保留原有一兆字节回执容量，简单和可空组合均可使用完整边界", () => {
    const empty = { text: "" };
    const value = "x".repeat(1024 * 1024 - new TextEncoder().encode(JSON.stringify(empty)).byteLength);
    const payload = { text: value };
    expect(new TextEncoder().encode(JSON.stringify(payload)).byteLength).toBe(1024 * 1024);
    for (const rule of [{ type: "string" }, { anyOf: [{ type: "string" }, { type: "null" }] }]) {
      expect(validateJsonObjectSchema(payload, { type: "object", required: ["text"], properties: { text: rule } })).toBeNull();
    }
  });
  it.each(["enum", "const"])("原有大文字 %s 回执不能被新的工作预算误拒绝", (keyword) => {
    const value = "x".repeat(600_000);
    const rule = keyword === "enum" ? { enum: [value] } : { const: value };
    expect(validateJsonObjectSchema({ value }, fieldSchema(rule))).toBeNull();
  });
  it("不同形状的旧枚举候选不能反复扫描同一大对象并误耗预算", () => {
    const expected = Object.fromEntries(Array.from({ length: 10_000 }, (_, index) => [`field_${index}`, 0]));
    const choices: unknown[] = Array.from({ length: 99 }, (_, index) => ({ missing: index }));
    choices.push(expected);
    const schema = fieldSchema({ enum: choices });
    expect(new TextEncoder().encode(JSON.stringify(schema)).byteLength).toBeLessThan(1024 * 1024);
    expect(validateJsonObjectSchema({ value: JSON.parse(JSON.stringify(expected)) }, schema)).toBeNull();
  });
  it("工作预算按每次调用独立计算，正常消息仍接受", () => {
    expect(validateJsonObjectSchema({ rows: ["first", "second"] }, costly)).toBeNull();
    expect(validateJsonObjectSchema({ rows: [""] }, costly)).toBeNull();
  });
});
