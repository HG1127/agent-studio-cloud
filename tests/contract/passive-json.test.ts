import { describe, expect, it, vi } from "vitest";
import { isPassiveJsonData } from "@/contracts/json";
describe("无副作用 JSON 预检", () => {
  it("保留普通冻结值和无环重复引用", () => {
    const shared = Object.freeze({ amount: 0, approved: false });
    expect(isPassiveJsonData(Object.freeze([shared, shared]), 100)).toBe(true);
  });
  it("访问器和序列化函数不执行", () => {
    const getter = vi.fn(), toJSON = vi.fn();
    const value = {}; Object.defineProperty(value, "field", { enumerable: true, get: getter });
    expect(isPassiveJsonData(value, 100)).toBe(false);
    expect(isPassiveJsonData({ toJSON }, 100)).toBe(false);
    expect(getter).not.toHaveBeenCalled(); expect(toJSON).not.toHaveBeenCalled();
  });
  it("字符、层级、条目和环均有界", () => {
    expect(isPassiveJsonData("abc", 2)).toBe(false);
    let deep: unknown = 0; for (let i = 0; i < 33; i++) deep = { child: deep };
    expect(isPassiveJsonData(deep, 1000)).toBe(false);
    expect(isPassiveJsonData(Array(50_000).fill(0), 1000)).toBe(false);
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(isPassiveJsonData(cycle, 1000)).toBe(false);
  });
  it("不接受会在 JSON 转换时悄悄丢失的属性", () => {
    const array = Object.assign([0], { other: "业务字段" });
    expect(isPassiveJsonData(array, 100)).toBe(false);
    expect(isPassiveJsonData({ [Symbol("业务")]: 0 }, 100)).toBe(false);
    expect(isPassiveJsonData(Object.defineProperty({}, "hidden", { value: 0 }), 100)).toBe(false);
    expect(isPassiveJsonData(new Date(), 100)).toBe(false);
  });
});
