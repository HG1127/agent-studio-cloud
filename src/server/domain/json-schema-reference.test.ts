import { describe, expect, it, vi } from "vitest";
import { MAX_LOCAL_SCHEMA_REFERENCE_HOPS, MAX_LOCAL_SCHEMA_REFERENCE_LENGTH, resolveLocalSchemaReference, schemaDialectSupportsLocalReferences } from "./json-schema-reference";

describe("本地字段规则引用的解析边界", () => {
  const leaf = { type: "string" };
  const root = { $defs: { Name: leaf, "客户": leaf, "a/b~c": leaf, "a~1b": leaf }, definitions: { OldName: leaf },
    properties: { name: leaf, allOf: leaf }, allOf: [leaf], anyOf: [false], oneOf: [true], items: leaf, not: false, additionalProperties: leaf };
  it.each([
    { reference: "#", target: root }, { reference: "#/$defs/Name", target: leaf },
    { reference: "#/definitions/OldName", target: leaf }, { reference: "#/properties/name", target: leaf },
    { reference: "#/properties/allOf", target: leaf }, { reference: "#/allOf/0", target: leaf },
    { reference: "#/anyOf/0", target: false }, { reference: "#/oneOf/0", target: true },
    { reference: "#/items", target: leaf }, { reference: "#/not", target: false },
    { reference: "#/additionalProperties", target: leaf }, { reference: "#/%24defs/%E5%AE%A2%E6%88%B7", target: leaf },
    { reference: "#/$defs/a~1b~0c", target: leaf }, { reference: "#/$defs/a~01b", target: leaf },
  ])("按模式位置和 JSON Pointer 解析 $reference", ({ reference, target }) => {
    const before = JSON.stringify(root), result = resolveLocalSchemaReference(root, reference);
    expect(result).toEqual({ ok: true, schema: target });
    if (result.ok) expect(result.schema).toBe(target);
    expect(JSON.stringify(root)).toBe(before);
  });
  it.each([undefined, null, 0, "", "Name", "#anchor", "https://fixture.example/private", "file:///private/schema.json", "//fixture.example/schema",
    "#/$defs/Missing", "#/$defs", "#/$defs/", "#/$defs/Name/type", "#/properties/name/default", "#/allOf/00", "#/allOf/-1", "#/allOf/1", "#/allOf",
    "#/$defs/constructor", "#/$defs/__proto__", "#/$defs/a~2b", "#/$defs/a~", "#/%XX", "#/%FF"])("未定义、外部、锚点、字面值或非法指针不解析 %#", (reference) => {
    expect(resolveLocalSchemaReference(root, reference)).toEqual({ ok: false });
  });
  it("不能把默认值或枚举里的对象当作字段规则", () => {
    const source = { default: { rule: leaf }, enum: [leaf], examples: [leaf], const: leaf, required: ["name"] };
    for (const reference of ["#/default/rule", "#/enum/0", "#/examples/0", "#/const", "#/required/0"]) {
      expect(resolveLocalSchemaReference(source, reference)).toEqual({ ok: false });
    }
  });
  it.each(["https://json-schema.org/draft/2020-12/schema", "http://json-schema.org/draft/2020-12/schema#", "https://json-schema.org/draft/2019-09/schema"])("现代方言支持引用同级规则 %s", ($schema) => {
    expect(resolveLocalSchemaReference({ ...root, $schema }, "#/$defs/Name")).toEqual({ ok: true, schema: leaf });
  });
  it.each(["http://json-schema.org/draft-07/schema#", "https://fixture.example/dialect", 1, null])("旧式或无法识别的方言不猜测引用语义 %#", ($schema) => {
    expect(schemaDialectSupportsLocalReferences({ $schema })).toBe(false);
    expect(resolveLocalSchemaReference({ ...root, $schema }, "#/$defs/Name")).toEqual({ ok: false });
  });
  it("指针不能跨入声明了不同方言的嵌套规则", () => {
    const schema = { $defs: { Nested: { $schema: "http://json-schema.org/draft-07/schema#", $defs: { Name: leaf } } } };
    expect(resolveLocalSchemaReference(schema, "#/$defs/Nested")).toEqual({ ok: false });
    expect(resolveLocalSchemaReference(schema, "#/$defs/Nested/$defs/Name")).toEqual({ ok: false });
  });
  it("引用文字长度边界保留，不裁剪目标名称", () => {
    const name = "x".repeat(MAX_LOCAL_SCHEMA_REFERENCE_LENGTH - "#/$defs/".length);
    expect(resolveLocalSchemaReference({ $defs: { [name]: leaf } }, `#/$defs/${name}`)).toEqual({ ok: true, schema: leaf });
    expect(resolveLocalSchemaReference({ $defs: { [`${name}x`]: leaf } }, `#/$defs/${name}x`)).toEqual({ ok: false });
  });
  it("指针段数有界，与数据字段深度是不同限制", () => {
    let schema: Record<string, unknown> = { not: true };
    for (let index = 0; index < MAX_LOCAL_SCHEMA_REFERENCE_HOPS / 2; index++) schema = { properties: { child: schema } };
    const pointer = `#${"/properties/child".repeat(MAX_LOCAL_SCHEMA_REFERENCE_HOPS / 2)}`;
    expect(resolveLocalSchemaReference(schema, pointer)).toEqual({ ok: true, schema: { not: true } });
    expect(resolveLocalSchemaReference(schema, `${pointer}/not`)).toEqual({ ok: false });
  });
  it("不执行目标或方言访问器，继承值不能冒充本地定义", () => {
    const read = vi.fn(() => leaf), definitions = Object.defineProperty({}, "Name", { enumerable: true, get: read });
    expect(resolveLocalSchemaReference({ $defs: definitions }, "#/$defs/Name")).toEqual({ ok: false });
    expect(resolveLocalSchemaReference({ get $defs() { return read(); } }, "#/$defs/Name")).toEqual({ ok: false });
    expect(resolveLocalSchemaReference({ ...root, get $schema() { read(); return "https://json-schema.org/draft/2020-12/schema"; } }, "#/$defs/Name")).toEqual({ ok: false });
    expect(resolveLocalSchemaReference({ $defs: Object.create({ Name: leaf }) }, "#/$defs/Name")).toEqual({ ok: false });
    expect(read).not.toHaveBeenCalled();
  });
});
