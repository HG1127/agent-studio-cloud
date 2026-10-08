import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { boundedJsonStorageValue, isPlainJsonObject } from "./json";
import { InputMapping } from "./input-mapping";
import { ModelOutputConfig } from "./model-output";
import { RunInputPayload } from "./run";

const foreign = (source: string) => runInNewContext(source) as unknown;
describe("跨持久工作流环境的普通 JSON 对象", () => {
  it("本地、空原型和另一环境的普通对象都被识别", () => {
    for (const value of [{}, Object.create(null), foreign("({ amount: 123.5 })"), foreign("Object.create(null)")]) {
      expect(isPlainJsonObject(value as object)).toBe(true);
    }
  });
  it("不因跨环境兼容放行类实例、日期或伪造的原型", () => {
    const forged = Object.create(null);
    forged.constructor = Object;
    for (const value of [new Date(), new (class Example {})(), Object.create({ id: 1 }), Object.create(forged),
      foreign("new Date()"), foreign("new (class Example {})()"), foreign("Object.create({ id: 1 })")]) {
      expect(isPlainJsonObject(value as object)).toBe(false);
      expect(boundedJsonStorageValue(1024, "测试值").safeParse(value).success).toBe(false);
    }
  });
  it("原型的构造器访问器不会被执行", () => {
    const prototype = Object.create(null);
    Object.defineProperty(prototype, "constructor", { get: () => { throw new Error("不得执行"); } });
    expect(isPlainJsonObject(Object.create(prototype))).toBe(false);
  });
  it("另一环境的嵌套对象和数组仍保留数值布尔与空值", () => {
    const value = foreign('({ amount: 123.5, approved: false, rows: [{ id: "c1" }, null] })');
    expect(boundedJsonStorageValue(1024, "测试值").parse(value)).toEqual({ amount: 123.5, approved: false, rows: [{ id: "c1" }, null] });
  });
  it("跨环境数据同样受容量、保留字段和有限数字约束", () => {
    for (const source of ['({ value: Infinity })', 'JSON.parse(\'{"__proto__":1}\')', '({ text: "a".repeat(1025) })']) {
      expect(boundedJsonStorageValue(1024, "测试值").safeParse(foreign(source)).success).toBe(false);
    }
  });
  it("跨环境循环引用仍在递归 Zod 校验前拒绝", () => {
    expect(boundedJsonStorageValue(1024, "测试值").safeParse(foreign("(() => { const x = {}; x.self = x; return x; })()")).success).toBe(false);
  });
  it("模型配置接受冻结参数中的结构化字段契约和模拟对象", () => {
    expect(ModelOutputConfig.parse(foreign('({ format: "json", schema: { type: "object", properties: { amount: { type: "number" } } }, mockOutput: { amount: 123.5 } })')))
      .toMatchObject({ mockOutput: { amount: 123.5 } });
  });
  it("字段映射接受冻结参数中的对象固定值和兜底值", () => {
    expect(InputMapping.parse(foreign('({ fields: [{ target: ["customer"], source: { kind: "literal", value: { id: "c1" } }, fallback: { id: "c2" } }] })')).fields[0])
      .toMatchObject({ source: { kind: "literal", value: { id: "c1" } }, fallback: { id: "c2" } });
  });
  it("运行输入接受另一环境对象但不放行其类实例", () => {
    expect(RunInputPayload.parse(foreign('({ customer: { id: "c1" }, amount: 0, approved: false })')))
      .toEqual({ customer: { id: "c1" }, amount: 0, approved: false });
    expect(RunInputPayload.safeParse(foreign('({ customer: new (class Customer {})() })')).success).toBe(false);
  });
});
