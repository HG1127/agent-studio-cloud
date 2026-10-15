import { describe, expect, it } from "vitest";
import { validateJsonObjectSchema, validateJsonSchemaDefinition } from "./json-schema";
import { MAX_LOCAL_SCHEMA_REFERENCE_HOPS } from "./json-schema-reference";
import { mcpToolDefinitionIssue, mcpToolInputDefinitionIssue, mcpToolOutputDefinitionIssue, normalizeMcpToolResult } from "./runtime/mcp-tool";
import { validateModelJsonOutput, validateModelOutputConfiguration } from "./runtime/model-output";
import { ModelOutputConfig } from "@/contracts/model-output";

function namedField(rule: unknown, name = "Field") {
  return { type: "object", required: ["value"], properties: { value: { $ref: `#/$defs/${name}` } }, $defs: { [name]: rule } };
}

function aliases(count: number): Record<string, unknown> {
  const $defs = Object.fromEntries(Array.from({ length: count }, (_, index) => [`Alias${index}`, index === count - 1 ? { type: "string" } : { $ref: `#/$defs/Alias${index + 1}`, title: "文字别名" }]));
  return { type: "object", required: ["value"], properties: { value: { $ref: "#/$defs/Alias0" } }, $defs };
}

describe("共享 JSON 字段契约本地定义复用", () => {
  it.each(["$defs", "definitions"])("嵌套对象、数组、零值与否定值共享 %s，契约和业务值不改写", (keyword) => {
    const schema = { type: "object", required: ["orders"], properties: { orders: { type: "array", items: { $ref: `#/${keyword}/Order` } } }, [keyword]: {
      Order: { type: "object", required: ["code", "amount", "active"], properties: { code: { $ref: `#/${keyword}/Code` }, amount: { type: "number", minimum: 0 }, active: { type: "boolean" } }, additionalProperties: false },
      Code: { type: "string", maxLength: 40, pattern: "^[A-Z]+[0-9]+$" },
    } };
    const payload = { orders: [{ code: "AB123", amount: 0, active: false }] }, before = JSON.stringify([schema, payload]);
    expect(validateJsonSchemaDefinition(schema)).toBeNull();
    expect(validateJsonObjectSchema(payload, schema)).toBeNull();
    expect(JSON.stringify([schema, payload])).toBe(before);
    expect(validateJsonObjectSchema({ orders: [{ code: "AB", amount: 0, active: false }] }, schema)).toContain("格式不符合");
    expect(validateJsonObjectSchema({ orders: [{ code: "AB123", amount: -1, active: false }] }, schema)).toContain("不能小于");
  });
  it.each([null, "客户"])("本地复用定义与可空组合共同接受 %j", (value) => {
    expect(validateJsonObjectSchema({ value }, namedField({ anyOf: [{ type: "string" }, { type: "null" }] }))).toBeNull();
  });
  it("引用目标与同级规则都生效，不用合并或覆盖替代交集", () => {
    const schema = { ...namedField({ type: "integer", minimum: 0 }), properties: { value: { $ref: "#/$defs/Field", maximum: 10, not: { const: 5 } } } };
    expect(validateJsonObjectSchema({ value: 0 }, schema)).toBeNull();
    for (const value of [-1, 5, 11, "0"]) expect(validateJsonObjectSchema({ value }, schema)).not.toBeNull();
  });
  it.each([true, false])("布尔定义引用不因真假值被忽略 %s", (allowed) => {
    expect(validateJsonSchemaDefinition(namedField(allowed))).toBeNull();
    expect(validateJsonObjectSchema({ value: 0 }, namedField(allowed)) === null).toBe(allowed);
  });
  it("本地指针可复用属性、组合和单子规则，但不能引用业务字面对象", () => {
    const schema = { type: "object", properties: { first: { type: "integer" }, second: { $ref: "#/properties/first" } } };
    expect(validateJsonObjectSchema({ first: 0, second: 1 }, schema)).toBeNull();
    expect(validateJsonObjectSchema({ second: "1" }, schema)).not.toBeNull();
    expect(validateJsonObjectSchema({}, { type: "object", const: { type: "object" }, $ref: "#/const" })).toContain("暂不支持的规则“$ref”");
  });
  it("引用名称按 URI 和 JSON Pointer 解码，近似名称不能串用", () => {
    const schema = { type: "object", properties: { value: { $ref: "#/%24defs/a~1b~0%E5%AE%A2%E6%88%B7" } }, $defs: { "a/b~客户": { const: 0 } } };
    expect(validateJsonObjectSchema({ value: 0 }, schema)).toBeNull();
    expect(validateJsonObjectSchema({ value: false }, schema)).not.toBeNull();
  });
  it("无引用的旧方言基本规则保留，但混合引用方言不猜测为现代语义", () => {
    const legacy = { $schema: "http://json-schema.org/draft-07/schema#", type: "string" };
    expect(validateJsonSchemaDefinition({ type: "object", properties: { value: legacy } })).toBeNull();
    const schema = { ...namedField({ type: "integer" }), $defs: { Field: { type: "integer" }, UnusedLegacy: legacy } };
    expect(validateJsonSchemaDefinition(schema)).toContain("不支持混合或未知");
    expect(validateJsonObjectSchema({ value: 0 }, schema)).toContain("不支持混合或未知");
  });
  it.each([null, [], "bad", { $ref: "https://fixture.example/private" }, { type: "object", properties: { constructor: {} } }, { type: "string", pattern: "[" }].map((invalid) => ({ invalid })))("未被引用的非法定义也先拒绝，不能靠可选分支绕过 %#", ({ invalid }) => {
    const schema = { type: "object", anyOf: [{}, { $ref: "#/$defs/Valid" }], $defs: { Valid: {}, Unused: invalid } };
    expect(validateJsonSchemaDefinition(schema)).not.toBeNull();
    expect(validateJsonObjectSchema({}, schema)).not.toBeNull();
  });
  it.each([null, [], 1, "defs"].map(($defs) => ({ $defs })))("定义容器必须是对象 %#", ({ $defs }) => {
    expect(validateJsonSchemaDefinition({ type: "object", $defs })).toContain("$defs 必须是对象");
  });
  it("每个定义容器仍限制一百个名称，保留键不能进入声明", () => {
    const $defs = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`D${index}`, { type: "string" }]));
    expect(validateJsonSchemaDefinition({ $defs })).toBeNull();
    expect(validateJsonSchemaDefinition({ $defs: { ...$defs, Extra: {} } })).toContain("不能超过 100 项字段定义");
    expect(validateJsonSchemaDefinition(JSON.parse('{"$defs":{"__proto__":{}}}'))).toContain("保留字段名");
  });
  it.each([
    { type: "object", $ref: "#" },
    { type: "object", $defs: { Loop: { $ref: "#/$defs/Loop" } } },
    { type: "object", $defs: { A: { $ref: "#/$defs/B" }, B: { $ref: "#/$defs/A" } } },
    { type: "object", $defs: { Node: { type: "object", properties: { child: { $ref: "#/$defs/Node" } } } } },
  ])("直接、互相和经数据字段的递归均在执行前明确拒绝 %#", (schema) => {
    expect(validateJsonSchemaDefinition(schema)).toContain("递归或循环");
    expect(validateJsonObjectSchema({}, schema)).toContain("递归或循环");
  });
  it("引用跳数上限与完整一兆字节简单回执兼容，纯别名不重复扫描正文", () => {
    const schema = aliases(MAX_LOCAL_SCHEMA_REFERENCE_HOPS);
    const value = "x".repeat(1024 * 1024 - new TextEncoder().encode(JSON.stringify({ value: "" })).byteLength);
    expect(validateJsonSchemaDefinition(schema)).toBeNull();
    expect(validateJsonObjectSchema({ value }, schema)).toBeNull();
    expect(validateJsonSchemaDefinition(aliases(MAX_LOCAL_SCHEMA_REFERENCE_HOPS + 1))).toContain("字段引用不能超过 32 层");
  });
  it("引用不扩充原字段深度限制，过深嵌套仍拒绝", () => {
    let rule: unknown = { type: "string" };
    for (let index = 0; index < 9; index++) rule = { properties: { child: rule } };
    expect(validateJsonSchemaDefinition(namedField(rule))).toContain("超过 8 层");
  });
  it("紧凑复用图的展开工作仍计原一万规则预算，不创建展开后的大对象", () => {
    const $defs: Record<string, unknown> = { L0: { const: 0 } };
    for (let index = 1; index <= 7; index++) $defs[`L${index}`] = { allOf: Array.from({ length: 4 }, () => ({ $ref: `#/$defs/L${index - 1}` })) };
    const schema = { type: "object", properties: { value: { $ref: "#/$defs/L7" } }, $defs };
    expect(new TextEncoder().encode(JSON.stringify(schema)).byteLength).toBeLessThan(32 * 1024);
    expect(validateJsonSchemaDefinition(schema)).toContain("不能超过 10000 项规则");
  });
  it.each(["allOf", "anyOf", "oneOf", "not"])("引用中的运行工作量超限不能被 %s 忽略或反转", (keyword) => {
    const costly = { type: "object", properties: { rows: { type: "array", items: { allOf: Array.from({ length: 100 }, () => ({ $ref: "#/$defs/Text" })) } } } };
    const schema = { $defs: { Text: { type: "string" } }, ...(keyword === "not" ? { not: costly } : { [keyword]: keyword === "allOf" ? [costly] : [costly, {}] }) };
    expect(validateJsonSchemaDefinition(schema)).toBeNull();
    expect(validateJsonObjectSchema({ rows: Array.from({ length: 50 }, () => "x".repeat(9000)) }, schema)).toContain("校验工作量超过 8388608 单位");
  });
  it("MCP 输入/输出冻结预检共用同一本地定义语义，未用定义变化也不能漂移", () => {
    const schema = namedField({ type: "integer", minimum: 0 });
    expect(mcpToolInputDefinitionIssue(schema)).toBeNull();
    expect(mcpToolDefinitionIssue(schema, schema)).toBeNull();
    expect(mcpToolOutputDefinitionIssue(schema, schema)).toBeNull();
    expect(normalizeMcpToolResult({ structuredContent: { value: 0 } }, schema)).toEqual({ ok: true, output: { value: 0 } });
    expect(normalizeMcpToolResult({ structuredContent: { value: false } }, schema).ok).toBe(false);
    const changed = { ...schema, $defs: { ...schema.$defs, Unused: { const: "new" } } };
    expect(mcpToolDefinitionIssue(changed, schema)).not.toBeNull();
    expect(mcpToolOutputDefinitionIssue(changed, schema)).not.toBeNull();
  });
  it("模型发布样例和运行结果复用引用检查，不另写宽松校验器", () => {
    const schema = namedField({ type: "integer", minimum: 0 });
    const modelOutput = ModelOutputConfig.parse({ format: "json", schema, mockOutput: { value: 0 } });
    expect(validateModelOutputConfiguration({ title: "提取结果", modelOutput })).toBeNull();
    expect(validateModelJsonOutput({ value: 0 }, schema)).toEqual({ ok: true, value: { value: 0 } });
    expect(validateModelJsonOutput({ value: "0" }, schema).ok).toBe(false);
  });
});
