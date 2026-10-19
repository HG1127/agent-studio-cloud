import { describe, expect, it } from "vitest";
import { type JsonStorageRecord } from "@/contracts/json";
import { MAX_RUN_RESULT_BYTES, RunResultValue } from "@/contracts/run";

function wrap(value: JsonStorageRecord, layers: number): JsonStorageRecord {
  for (let index = 0; index < layers; index++) value = { nested: value };
  return value;
}

describe("保存成果的共享展示边界", () => {
  it.each([0, false, null, "", [], {}, "业务说明", 42].map((value) => ({ value })))("保留根值 $value，不做真假值替换", ({ value }) => {
    expect(RunResultValue.parse(value)).toEqual(value);
  });

  it.each(["object", "array"] as const)("%s 允许完整32层而拒绝第33层", (shape) => {
    const payload: JsonStorageRecord = shape === "object" ? { amount: 0 } : { rows: [{ approved: false }] };
    const value = wrap(payload, shape === "object" ? 31 : 29);
    expect(RunResultValue.parse(value)).toEqual(value);
    expect(RunResultValue.safeParse({ nested: value }).success).toBe(false);
  });

  it.each([undefined, NaN, Infinity, 1n, () => 0, new Date(), new Map(), /text/].map((value) => ({ value })))("拒绝非JSON值 $value", ({ value }) => {
    expect(RunResultValue.safeParse(value).success).toBe(false);
  });

  it("拒绝循环但允许重复引用的无环JSON子值", () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(RunResultValue.safeParse(cycle).success).toBe(false);
    const leaf = { amount: 0, approved: false };
    expect(RunResultValue.parse({ left: leaf, right: leaf })).toEqual({ left: leaf, right: leaf });
  });

  it.each(["getter", "toJSON", "hidden", "symbol"] as const)("拒绝 %s 执行或隐藏属性且不调用它们", (type) => {
    let called = 0;
    const value: Record<string | symbol, unknown> = { amount: 0 };
    if (type === "getter") Object.defineProperty(value, "detail", { enumerable: true, get: () => { called++; return "private"; } });
    else if (type === "toJSON") value.toJSON = () => { called++; return {}; };
    else if (type === "hidden") Object.defineProperty(value, "detail", { enumerable: false, value: "private" });
    else value[Symbol("private")] = "private";
    expect(RunResultValue.safeParse(value).success).toBe(false);
    expect(called).toBe(0);
  });

  it.each(["__proto__", "constructor", "prototype"])("拒绝保留字段 %s", (key) => {
    expect(RunResultValue.safeParse(Object.fromEntries([[key, "业务值"]])).success).toBe(false);
  });

  it("只允许普通对象或空原型对象", () => {
    expect(RunResultValue.safeParse(Object.create({ amount: 0 })).success).toBe(false);
    expect(RunResultValue.parse(Object.assign(Object.create(null), { amount: 0 }))).toEqual({ amount: 0 });
  });

  it.each(["ascii", "utf8"] as const)("%s 按完整两兆UTF8正文核对容量，不裁剪", (shape) => {
    const value = { text: "" };
    const remaining = MAX_RUN_RESULT_BYTES - new TextEncoder().encode(JSON.stringify(value)).byteLength;
    value.text = shape === "ascii" ? "x".repeat(remaining) : "中".repeat(Math.floor(remaining / 3)) + "x".repeat(remaining % 3);
    expect(new TextEncoder().encode(JSON.stringify(value)).byteLength).toBe(MAX_RUN_RESULT_BYTES);
    expect(RunResultValue.parse(value)).toEqual(value);
    expect(RunResultValue.safeParse({ text: value.text + "x" }).success).toBe(false);
  });

  it("允许五万项边界，超过时整份拒绝而不是截断", () => {
    const value = Array.from({ length: 49_999 }, () => 0);
    expect(RunResultValue.parse(value)).toEqual(value);
    expect(RunResultValue.safeParse([...value, 0]).success).toBe(false);
  });
});
